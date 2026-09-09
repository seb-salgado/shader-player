"use client"

import { useState, useRef, useEffect, type CSSProperties } from "react"
import { AnimatePresence, useReducedMotion } from "framer-motion"
import { ShaderCanvas, type ShaderCanvasRef } from "@/components/shader-canvas"
import { ControlsSidebar } from "@/components/controls-sidebar"
import { MobileNav } from "@/components/mobile-nav"
import { FloatingToolbar } from "@/components/floating-toolbar"
import { WallpaperGallery } from "@/components/wallpaper-gallery"
import { GalleryCloseFlight, type CloseFlight } from "@/components/gallery-close-flight"
import type { ShaderParams } from "@/lib/shader-uniforms"
import type { Capture } from "@/lib/types"
import { encodeFullResolutionDecoded, freezeFrame, previewDataUrl } from "@/lib/canvas-capture"
import { warmPngEncoder } from "@/lib/png-encoder"
import { CaptureDismissal } from "@/components/capture-dismissal"
import type { CaptureMode } from "@/components/mode-tabs"
import { isVideoCaptureSupported } from "@/lib/video-capture"
import { useVideoRecorder } from "@/hooks/use-video-recorder"
import { RecordingTimer } from "@/components/recording-timer"
import { CaptureFlash } from "@/components/capture-flash"
import { Toaster } from "@/components/ui/sonner"
import { captureFlash, controlsSplit } from "@/lib/springs"
import { getShaderConfig } from "@/lib/shader-configs"
import { useResizableSidebar } from "@/hooks/use-resizable-sidebar"
import { useControlsSplit } from "@/hooks/use-controls-split"
import { useIsMobile } from "@/hooks/use-mobile"
import { cn } from "@/lib/utils"

export default function Home() {
  const [shaderId, setShaderId] = useState<string>("terracotta")
  // Mobile is dark-only, so the palette is pinned at the root rather than
  // scoped piecemeal below it. See the note on the container's className.
  const isMobile = useIsMobile()
  const prefersReducedMotion = useReducedMotion()
  const { isResizing, startResize } = useResizableSidebar()
  const [params, setParams] = useState<ShaderParams>(getShaderConfig("terracotta").defaultParams)

  /**
   * What the shutter produces, and whether the shader is running.
   *
   * Seeded "video" for everyone, including on the server, and corrected to
   * "image" in the effect below for anyone who asked for reduced motion. It
   * cannot be seeded from the hook directly: framer's useReducedMotion returns
   * null server-side and the real answer on the client's first render, so
   * useState(prefersReducedMotion ? …) is a hydration mismatch — and the default
   * has to be "video" regardless, because booting a shader player into a still
   * image would be the wrong app.
   */
  const [mode, setMode] = useState<CaptureMode>("video")
  const modeChosenRef = useRef(false)

  useEffect(() => {
    // Reduced motion picks the *initial* mode and nothing else. It is
    // deliberately absent from isFrozen below: choosing a mode named Video is
    // the consent for motion, and a runtime term would silently undo that
    // choice every time the gallery closed. This supersedes the boundary plan
    // 001 drew, which put the decision inside the canvas.
    //
    // Never overrules a deliberate choice — note that framer's hook does not
    // re-subscribe, so this settles once on the client's first render.
    if (!modeChosenRef.current && prefersReducedMotion) setMode("image")
  }, [prefersReducedMotion])

  const handleModeChange = (next: CaptureMode) => {
    modeChosenRef.current = true
    setMode(next)
  }

  /**
   * Whether this browser can record at all.
   *
   * Starts true so the server render and the client's first paint agree, and so
   * the 99% get the control with no shift; the rare browser without
   * MediaRecorder drops it one commit later. Hidden rather than disabled — a
   * two-item control with one item permanently greyed is worse than no control,
   * and with it gone the app is exactly what it was before video existed.
   */
  const [videoSupported, setVideoSupported] = useState(true)
  useEffect(() => {
    setVideoSupported(isVideoCaptureSupported())
  }, [])

  const [captures, setCaptures] = useState<Capture[]>([])
  const [isGalleryOpen, setIsGalleryOpen] = useState(false)
  const [selectedIndex, setSelectedIndex] = useState(0)
  const [clickedCaptureId, setClickedCaptureId] = useState<string | null>(null)
  // Set when the gallery is dismissed from a capture other than the one it was
  // opened on, which is the one the thumbnail is showing. The shared-element
  // morph cannot draw that — see GalleryCloseFlight — so it is stood down for as
  // long as this is here, and the flight collapses the capture instead.
  const [closeFlight, setCloseFlight] = useState<CloseFlight | null>(null)
  const shaderCanvasRef = useRef<ShaderCanvasRef>(null)

  // Bumped on every capture. The flash element is keyed off this, so each press
  // remounts it and gets its own animation from the start — a counter rather
  // than a boolean because two captures in quick succession must not collapse
  // into one blink.
  const [flashKey, setFlashKey] = useState(0)

  /**
   * Whether the mobile controls have the bottom half of the screen.
   *
   * Owned here rather than in MobileNav, where it used to live as `sheetOpen`,
   * because it is no longer only the bar's business: opening the controls scales
   * the canvas below, and the canvas is this file's.
   */
  const [controlsOpen, setControlsOpen] = useState(false)
  const { rootRef, canvasBoxRef, scale: canvasScale } = useControlsSplit(isMobile)

  // Crossing to desktop with the panel open would leave a dialog pinned over a
  // layout that has a sidebar for exactly this. Nothing to animate on the way
  // out: the surface it belonged to is already gone.
  useEffect(() => {
    if (!isMobile) setControlsOpen(false)
  }, [isMobile])

  const isCanvasScaled = isMobile && controlsOpen && canvasScale !== null

  // The encoder's thread costs about a tenth of a second to start, and it is
  // started by whatever asks it for the first PNG — which, left alone, is the
  // first capture of the session. Paid here instead, while the page is settling.
  useEffect(() => {
    if (typeof window.requestIdleCallback === "function") {
      const handle = window.requestIdleCallback(() => warmPngEncoder(), { timeout: 2000 })
      return () => window.cancelIdleCallback(handle)
    }
    const timer = window.setTimeout(warmPngEncoder, 1200)
    return () => window.clearTimeout(timer)
  }, [])

  const handleShaderChange = (newShaderId: string) => {
    console.log("[v0] Changing shader to:", newShaderId)
    setShaderId(newShaderId)
    const newConfig = getShaderConfig(newShaderId)
    setParams(newConfig.defaultParams)
  }

  const captureImage = (canvas: HTMLCanvasElement) => {
    // Nothing on the click path may encode.
    //
    // The full-resolution PNG costs 70–94ms of main-thread work, and every
    // arrangement of *when* to pay it is wrong: before the flash it delays the
    // response past the point where it reads as instant; during the flash it
    // freezes the animation mid-blink; and gating the toolbar on it is what made
    // the slot start widening after the flash had already finished.
    //
    // So the click path does two cheap things — a GPU blit to freeze the frame,
    // and a 128px JPEG of it — and the capture enters state immediately. The
    // flash, the slot and the thumbnail all begin on the same frame off the same
    // commit, which is the choreography this wants. Nothing at 48px can tell the
    // difference between the preview and the real thing.
    const frozen = freezeFrame(canvas)
    if (!frozen) return

    const id = `${Date.now()}-${Math.random()}`
    setCaptures((prev) => [
      ...prev,
      {
        id,
        kind: "image",
        dataUrl: previewDataUrl(frozen),
        timestamp: Date.now(),
        // The frozen frame's real dimensions, not the preview's. The thumbnail's
        // cover box and the gallery's letterboxing are both computed from these,
        // and the preview shares the aspect ratio, so neither has to wait.
        width: frozen.width,
        height: frozen.height,
        params: { ...params },
        shaderId: shaderId,
      },
    ])
    setFlashKey((k) => k + 1)

    // The real capture, once everything has stopped moving. Held rather than
    // fired immediately because toBlob still has to hand the result back to this
    // thread, and the flash is the last thing that should be interrupted.
    window.setTimeout(async () => {
      const full = await encodeFullResolutionDecoded(frozen)
      if (!full) return
      setCaptures((prev) => prev.map((c) => (c.id === id ? { ...c, dataUrl: full } : c)))
    }, captureFlash.durationMs + 60)
  }

  /**
   * Frame 0 of the recording in flight, held for as long as it runs.
   *
   * Frame 0 and not the last frame: the thumbnail, the gallery's morph target
   * and the video's own first frame are then the same picture, so when the video
   * fades in over the poster there is nothing to reconcile.
   */
  const posterFrameRef = useRef<HTMLCanvasElement | null>(null)

  const recorder = useVideoRecorder({
    onComplete: ({ url, mimeType, durationMs, width, height }) => {
      const id = `${Date.now()}-${Math.random()}`
      const frozen = posterFrameRef.current
      posterFrameRef.current = null

      setCaptures((prev) => [
        ...prev,
        {
          id,
          kind: "video",
          dataUrl: url,
          posterUrl: frozen ? previewDataUrl(frozen) : "",
          mimeType,
          durationMs,
          timestamp: Date.now(),
          width,
          height,
          params: { ...params },
          shaderId,
        },
      ])

      // The poster upgraded to full resolution, on the same delay and for the
      // same reason as an image capture's: it is the picture the gallery morph
      // carries to full screen, and a 128px preview held there for the length of
      // a 450ms flight is visibly soft.
      if (!frozen) return
      window.setTimeout(async () => {
        const full = await encodeFullResolutionDecoded(frozen)
        if (!full) return
        setCaptures((prev) => prev.map((c) => (c.id === id ? { ...c, posterUrl: full } : c)))
      }, captureFlash.durationMs + 60)
    },
  })

  // Every reason the canvas stops, in one place, and reduced motion is not among
  // them — it chose the mode above, and the mode is what speaks here.
  //
  // **Recording wins over everything.** captureStream reads whatever the canvas
  // last drew, so a stopped loop does not record a pause: it records fifteen
  // seconds of one frame. The other two terms cannot arrive during a recording
  // anyway — the mode control and the gallery thumbnail are both inert while one
  // runs — but the precedence is written here rather than relied upon there.
  //
  // Image mode is frame rate zero by definition. The gallery is opaque over the
  // canvas, so running the shader behind it is work nobody can see.
  const isFrozen = recorder.isRecording ? false : isGalleryOpen || mode === "image"

  /**
   * One button, three jobs, decided here rather than in the shutter.
   *
   * No flash on the video path: a flash is a shutter event, and a recording does
   * not have one — it has a ring and a timecode instead.
   */
  const handleShutterPress = () => {
    const canvas = shaderCanvasRef.current?.getCanvas()
    if (!canvas) return

    if (mode === "image") {
      captureImage(canvas)
      return
    }
    if (recorder.isRecording) {
      recorder.stop()
      return
    }
    // Taken before the recorder starts, so the poster is the frame the recording
    // opens on rather than one frame into it.
    posterFrameRef.current = freezeFrame(canvas)
    recorder.start(canvas)
  }

  const handleDeleteCapture = (id: string) => {
    // Nothing left to show closes the desktop slot again, which falls out of
    // hasSlot below rather than needing its own flag.
    const doomed = captures.find((c) => c.id === id)
    setCaptures(captures.filter((c) => c.id !== id))

    // The full-resolution capture is a blob the browser keeps alive until its
    // URL is revoked. On a delay because this now fires on the press frame,
    // with the evaporation of this very capture about to start — the effect
    // already holds its pixels as a texture, but a still-unfinished prepare
    // would be reading from this URL, and the outgoing <img> holds it for the
    // frame in which it unmounts.
    //
    // **Both** URLs. A video capture holds two: the recording, and the
    // full-resolution poster that replaced its 128px preview. Revoking only
    // dataUrl — which is all there was to revoke when every capture was a PNG —
    // would leak a poster per recording for the life of the session.
    const doomedUrls = [doomed?.dataUrl, doomed?.posterUrl].filter(
      (url): url is string => !!url && url.startsWith("blob:"),
    )
    if (doomedUrls.length) {
      window.setTimeout(() => doomedUrls.forEach((url) => URL.revokeObjectURL(url)), 1000)
    }
  }

  const handleGalleryClose = (flight?: CloseFlight) => {
    setIsGalleryOpen(false)
    // One commit: the gallery's shared element goes out with its subtree and the
    // thumbnail leaves the layoutId stack at the same time, so the stack empties
    // rather than leaving a member behind to fly home on its own.
    if (flight) setCloseFlight(flight)
  }

  // The galleries lay their captures out in the order they were taken, so the
  // index the toolbar hands us is already the one they want — no flip on the
  // way in. See the ordering note in either gallery for why that direction.
  const handleThumbnailClick = (captureIndex: number) => {
    // The bars also make the thumbnail pointer-inert while recording, but that
    // only stops a pointer: `pointer-events: none` does not stop a keyboard
    // activation, and the gallery opening mid-clip would leave the shader
    // animating at full cost behind an opaque backdrop.
    if (recorder.isRecording) return
    const clicked = captures[captureIndex]
    if (!clicked) return
    // Opening again before the last close has landed: drop the flight so the
    // thumbnail is back in the layoutId stack for the morph it is about to lead.
    setCloseFlight(null)
    setClickedCaptureId(clicked.id)
    setSelectedIndex(captureIndex)
    setIsGalleryOpen(true)
  }

  return (
    // h-screen (100vh) is the *large* viewport on iOS: it ignores Safari's
    // toolbar, so the control bar ends up underneath it. 100dvh tracks the
    // viewport that is actually visible. Kept as an inline override rather than
    // a class swap so browsers without dvh drop the declaration and fall back
    // to h-screen instead of collapsing.
    //
    // --sidebar-width is deliberately not set here. The server cannot know the
    // stored width, so emitting it would paint the default and then correct
    // itself — and an inline value on this element would also outrank the one
    // the boot script has already put on the document. It lives on the document
    // element instead, seeded pre-paint and maintained by useResizableSidebar;
    // the canvas just takes whatever flex-1 leaves over.
    <div
      ref={rootRef}
      // `dark` on the root below md, which is the one place it can go and cover
      // everything: mobile has no light mode at all. The bar, the sheet and the
      // canvas already pinned themselves dark individually, but that left every
      // root-level sibling following the page theme — the wallpaper gallery
      // most visibly, since it is `fixed inset-0 bg-background` and opens from
      // the capture thumbnail. Pinning here catches those, and catches anything
      // added at this level later.
      //
      // The objection that once kept `dark` off this container — that it would
      // drag the desktop sidebar in with it — doesn't apply, because the class
      // is only ever present at widths where the sidebar is display:none.
      //
      // This overrides the rendered palette, not the stored preference: a theme
      // chosen on desktop is still there on return.
      // `bg-background` is not decoration. Once the canvas scales down it stops
      // covering its own box, and the gutters either side of it fall through to
      // whatever is behind — which without this is <body>. It used to carry a
      // `dark` beside it, back when <body> could be painted from a light page
      // theme and a phone would have framed the artwork in white.
      className={cn(
        "h-screen w-screen flex flex-col md:flex-row overflow-hidden",
        isMobile && "bg-background",
      )}
      style={{ height: "100dvh" } as CSSProperties}
    >
      {/* Shader Canvas.
          Two elements on purpose: the rounded corners reveal whatever is painted
          *behind* the clipped wrapper, so the surround carries the colour.
          Transparent from md up, where the canvas is square and fills its box. */}
      <div ref={canvasBoxRef} className="flex-1 min-h-0 bg-background md:bg-transparent">
        {/* The unscaled box, and the reason there are three elements here rather
            than the two there used to be. It is the frame of reference for
            anything that must keep its size while the viewfinder steps back. */}
        <div className="relative h-full w-full">
          {/* overflow-hidden is what actually clips the canvas: the radius sits
              on this wrapper, not on the <canvas> itself.

              And this is the element that scales. `transform-origin: top center`
              keeps the top edge still and opens the gutters symmetrically, which
              is the whole shape of the gesture. The radius scales with it, from
              12px to about 7.5 — correct, and not a rounding error: a card that
              has moved away has smaller corners. */}
          <div
            className="absolute inset-0 overflow-hidden rounded-[12px] md:rounded-none"
            style={{
              transformOrigin: "top center",
              transform: isCanvasScaled ? `scale(${canvasScale})` : undefined,
              transitionProperty: "transform",
              // One duration, shared with the panel, and no delay in either
              // direction. This edge and the sheet's top edge travel the same
              // way at the same time on the same curve — the screen splitting
              // open rather than the canvas moving and the panel then following
              // it. Both halves of that live in controlsSplit.enter/exit; the
              // sequencing this used to do is gone with the fade that needed it.
              transitionDuration: prefersReducedMotion
                ? "0ms"
                : `${controlsOpen ? controlsSplit.enter.durationMs : controlsSplit.exit.durationMs}ms`,
              transitionTimingFunction: controlsSplit.ease,
            }}
          >
            <ShaderCanvas ref={shaderCanvasRef} params={params} shaderId={shaderId} isFrozen={isFrozen} />
            {/* In here rather than over the whole page, so the blink is the
                viewfinder's and not the app's: the chrome is the camera body and
                stays put. Being inside the clip also gets it the artwork's exact
                rounded corners for free — and inside the scale, which is right:
                the flash is the frame blinking, so it is whatever size the frame
                currently is. */}
            {flashKey > 0 && <CaptureFlash key={flashKey} />}
          </div>

          {/* The timecode, in the viewfinder rather than over the page — the same
              rule the flash above follows, and where a camera puts it anyway.
              Not in the recording; see RecordingTimer.

              Outside the scale, though, and that is what the extra element is
              for. A timecode is a readout, not part of the picture: taken down
              to 62% it is eight pixels tall and unreadable. It does not have to
              move to stay out of it — its `top` already sits on the transform
              origin's row, and its `left: min(50vw, …)` resolves to the origin's
              own column on mobile, so leaving it here parks it exactly where the
              scaled viewfinder's top edge is. */}
          <AnimatePresence>
            {recorder.isRecording && (
              <RecordingTimer key="recording-timer" elapsedMs={recorder.elapsedMs} />
            )}
          </AnimatePresence>
        </div>
      </div>

      {/* Desktop Sidebar */}
      <div className="hidden md:block">
        <ControlsSidebar
          params={params}
          setParams={setParams}
          shaderId={shaderId}
          onResizeStart={startResize}
          isResizing={isResizing}
        />
      </div>

      <MobileNav
        onCapture={handleShutterPress}
        isRecording={recorder.isRecording}
        recordingProgress={recorder.progress}
        params={params}
        setParams={setParams}
        shaderId={shaderId}
        onShaderChange={handleShaderChange}
        mode={mode}
        onModeChange={handleModeChange}
        videoSupported={videoSupported}
        captures={captures}
        onThumbnailClick={handleThumbnailClick}
        suppressMorph={!!closeFlight}
        controlsOpen={controlsOpen}
        onControlsOpenChange={setControlsOpen}
      />

      {/* Desktop's floating control bar. A sibling of the canvas, never a child:
          the canvas wrapper above is scoped `dark`, and this bar follows the
          page theme. */}
      <FloatingToolbar
        shaderId={shaderId}
        onShaderChange={handleShaderChange}
        mode={mode}
        onModeChange={handleModeChange}
        videoSupported={videoSupported}
        onCapture={handleShutterPress}
        isRecording={recorder.isRecording}
        recordingProgress={recorder.progress}
        captures={captures}
        onThumbnailClick={handleThumbnailClick}
        hasSlot={captures.length > 0}
        suppressMorph={!!closeFlight}
      />

      <AnimatePresence>
        {isGalleryOpen && clickedCaptureId && (
          <WallpaperGallery
            key="gallery"
            captures={captures}
            onClose={handleGalleryClose}
            onDelete={handleDeleteCapture}
            initialIndex={selectedIndex}
            openedCaptureId={clickedCaptureId}
            isMobile={isMobile}
          />
        )}
      </AnimatePresence>

      {/* Where a deleted capture's exit draws. At the root rather than inside
          the gallery because deleting the last capture closes the gallery on the
          press frame, and the outgoing frame has to outlive that unmount. */}
      <CaptureDismissal />

      {/* Bottom-centre, where this app's chrome lives — the toolbar and the
          mobile bar are both down there, so a message arriving at the bottom
          reads as part of the same furniture rather than as something the
          browser did. The toolbar is not a conflict in practice: the only thing
          that raises a toast is the download, and the gallery is over the top of
          the toolbar whenever that is reachable. The offset clears the home
          indicator, since the gallery is edge to edge.

          Inside this container rather than in the layout, and that is the whole
          reason it moved here. Sonner renders where it is placed, and at the
          layout it landed as a sibling of this div — outside the `dark` pinned
          on it above. Mobile is dark whatever the page theme says, so a phone on
          a light system theme resolved --surface-3 to #252525 for every other
          surface and #fff for the toast. Same subtree, same tokens. */}
      <Toaster
        position="bottom-center"
        duration={2500}
        offset="max(1.25rem, calc(env(safe-area-inset-bottom) + 0.75rem))"
      />

      {/* Outside the AnimatePresence above on purpose: the gallery is unmounted
          as soon as its backdrop has finished fading, a good 200ms before this
          lands, and its root drops below the control bars on the close frame. */}
      {closeFlight && (
        <GalleryCloseFlight
          key={closeFlight.capture.id}
          flight={closeFlight}
          onComplete={() => setCloseFlight(null)}
        />
      )}
    </div>
  )
}
