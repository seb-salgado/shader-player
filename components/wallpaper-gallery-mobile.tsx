"use client"

import { useState, useEffect, useLayoutEffect, useRef, useCallback } from "react"
import { motion, useIsPresent, useReducedMotion } from "framer-motion"
import * as Dialog from "@radix-ui/react-dialog"
import { X, Download, Trash2 } from "lucide-react"
import { BlossomCarousel, type BlossomCarouselHandle } from "@blossom-carousel/react"
import { Button } from "@/components/ui/button"
import { type Capture, stillUrl } from "@/lib/types"
import type { CloseFlight } from "@/components/gallery-close-flight"
import { closeFlightFrom } from "@/components/gallery-close-flight"
import { downloadCapture } from "@/lib/canvas-capture"
import { GalleryVideo } from "@/components/gallery-video"
import { GalleryVideoControls } from "@/components/gallery-video-controls"
import { useRecordingPlayback } from "@/hooks/use-recording-playback"
import { playDownloadConfirmation } from "@/lib/download-audio"
import { toast } from "sonner"
import { galleryMorph } from "@/lib/springs"
import { cn } from "@/lib/utils"
import { dismissCapture } from "@/components/capture-dismissal"
import { useCaptureReplacement } from "@/hooks/use-capture-replacement"
import { GalleryThumbnailStrip } from "@/components/gallery-thumbnail-strip"

const galleryButtonClass =
  "pointer-events-auto cursor-pointer rounded-full bg-background/50 backdrop-blur-md border border-border text-foreground hoverFine:!bg-foreground/[0.06] hoverFine:!text-foreground focusKey:!bg-foreground/[0.06] focusKey:!text-foreground focusKey:border-ring focusKey:ring-ring/50 [&_svg]:text-foreground transition-[background-color,transform,opacity] duration-150 active:scale-[0.97]"

/** Long enough to outlast galleryMorph, in case its completion never fires. */
const MORPH_FALLBACK_MS = Math.round(galleryMorph.duration * 1000) + 100

interface WallpaperGalleryProps {
  captures: Capture[]
  onClose: (flight?: CloseFlight) => void
  onDelete: (id: string) => void
  initialIndex?: number
  openedCaptureId: string
}

export function WallpaperGalleryMobile({
  captures,
  onClose,
  onDelete,
  initialIndex = 0,
  openedCaptureId,
}: WallpaperGalleryProps) {
  // Oldest to newest, left to right, so the capture you just took sits at the
  // right-hand end and you swipe rightwards to walk back through the older
  // ones. The reverse of this reads fine as a list — newest first — but a
  // carousel is not a list: it is a strip of film, and on a strip of film time
  // runs one way. Photos, Camera Roll and every scrubber you have ever used
  // agree on which. The toolbar hands the index down already in this order.
  const captureCount = captures.length

  const [currentIndex, setCurrentIndex] = useState(initialIndex)
  // Suppresses the parallax while the shared element is in flight. True from the
  // first frame, since the gallery only ever mounts into an opening morph.
  const [isMorphing, setIsMorphing] = useState(true)

  const { replacing, replacementStyle, beginReplacement } = useCaptureReplacement("x")

  const carouselRef = useRef<BlossomCarouselHandle>(null)
  const closeButtonRef = useRef<HTMLButtonElement>(null)
  const restoreFocusRef = useRef<HTMLElement | null>(
    typeof document !== "undefined" && document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null,
  )
  const scrollFrameRef = useRef(0)
  const seededRef = useRef(false)
  // Read by the re-centring effect below, which must not re-run when the index
  // changes — that effect exists to follow a deletion, not to fight a scroll.
  const currentIndexRef = useRef(currentIndex)
  currentIndexRef.current = currentIndex

  /**
   * The one slide allowed to hold a `<video>`.
   *
   * Every capture's slide is in the DOM at once — the carousel is not
   * virtualised — so mounting a video per slide would spin up a decoder for
   * every recording in the session. It lags `currentIndex` by a moment as well,
   * so a fast swipe across several captures does not start and tear down a
   * decoder for each one it passes. Mid-swipe every slide shows its poster,
   * which is what you want to see anyway.
   */
  const [videoIndex, setVideoIndex] = useState(initialIndex)
  useEffect(() => {
    const timer = window.setTimeout(() => setVideoIndex(currentIndex), 120)
    return () => window.clearTimeout(timer)
  }, [currentIndex])

  // The capture on screen, as painted, for a close that has to draw its own
  // collapse — see handleClose. Nulls are ignored rather than stored: React
  // detaches the outgoing slide's ref and attaches the incoming one in the same
  // commit, and only the arrival is news.
  const captureRef = useRef<HTMLImageElement | null>(null)
  const setCaptureNode = useCallback((node: HTMLImageElement | null) => {
    if (node) captureRef.current = node
  }, [])

  /**
   * The rect the opened capture actually occupies on screen — the letterboxed
   * box, not the viewport.
   *
   * This is what the morph has to land on. A card that grows to the full
   * viewport is a different shape from the photo inside it, so the letterbox
   * opens up *during* the flight and you watch black bars grow at the top and
   * bottom of a card that is still travelling. Growing to the photo's own rect
   * instead means the capture fills the card from the first frame to the last,
   * and the black either side of it is just the backdrop the card has not
   * reached yet.
   *
   * documentElement rather than window.innerHeight: this is the box a
   * `position: fixed; inset: 0` element resolves against, and on iOS those two
   * are different numbers whenever the address bar is part-way through
   * collapsing.
   */
  const openedCapture = captures.find((c) => c.id === openedCaptureId)
  const measureFitBox = useCallback(() => {
    const viewportWidth = document.documentElement.clientWidth
    const viewportHeight = document.documentElement.clientHeight
    // A capture taken before the canvas was sized comes back 0×0; nothing sane
    // to fit, so let it have the whole viewport.
    if (!openedCapture?.width || !openedCapture?.height) {
      return { width: viewportWidth, height: viewportHeight }
    }
    const scale = Math.min(viewportWidth / openedCapture.width, viewportHeight / openedCapture.height)
    return { width: openedCapture.width * scale, height: openedCapture.height * scale }
  }, [openedCapture])

  const [fitBox, setFitBox] = useState(measureFitBox)

  useEffect(() => {
    const handleResize = () => setFitBox(measureFitBox())
    window.addEventListener("resize", handleResize)
    return () => window.removeEventListener("resize", handleResize)
  }, [measureFitBox])

  const prefersReducedMotion = useReducedMotion()
  // Flips false the instant AnimatePresence starts removing us — long before it
  // actually unmounts us, which it will not do until the fades below finish.
  // See the shared-element container's own comment for why that matters.
  const isPresent = useIsPresent()

  /**
   * The recording's transport, if the capture on screen is one.
   *
   * Keyed on the capture the *scroller* is on rather than the one holding the
   * mounted `<video>`, and the two are apart for 120ms after every swipe (see
   * `videoIndex`). Keying it here is what lets the bar stay put across a swipe
   * between two recordings: the readout comes off `capture.durationMs`, which is
   * known before any element exists, so it is already correct on the frame the
   * new clip lands — the element simply catches up to it.
   */
  const shownCapture = captures[currentIndex]
  const playback = useRecordingPlayback(shownCapture)
  const showsVideo = shownCapture?.kind === "video"

  const scrollToIndex = useCallback((index: number, smooth: boolean) => {
    const element = carouselRef.current?.element
    if (!element) return
    element.scrollTo({ left: index * element.clientWidth, behavior: smooth ? "smooth" : "instant" })
  }, [])

  /**
   * Puts the scroller on the capture that was clicked, before anything is
   * painted or measured.
   *
   * A ref callback is the only window that works. React attaches refs in the
   * commit phase with the whole slide row already in the DOM, and it does so
   * from the inside out — so this runs before the container above has been
   * measured for the morph. An effect on this component would run after it, and
   * the thumbnail would fly to slide zero and only then jump sideways.
   */
  const seedScroll = useCallback(
    (node: HTMLDivElement | null) => {
      if (!node || seededRef.current) return
      seededRef.current = true
      const element = node.parentElement
      // scroll-behavior is smooth on the scroller, so this cannot be a plain
      // scrollLeft assignment — that would animate the seed into view.
      element?.scrollTo({ left: initialIndex * element.clientWidth, behavior: "instant" })
    },
    [initialIndex],
  )

  /** The snapped slide, read off the scroller rather than tracked by hand. */
  const handleScroll = useCallback(() => {
    if (scrollFrameRef.current) return
    scrollFrameRef.current = requestAnimationFrame(() => {
      scrollFrameRef.current = 0
      const element = carouselRef.current?.element
      if (!element?.clientWidth) return
      const index = Math.round(element.scrollLeft / element.clientWidth)
      // Only ever a state change on a crossing, never per frame: a re-render on
      // every frame of a scroll is how you drop the frames you just gained.
      setCurrentIndex((previous) => (previous === index ? previous : index))
    })
  }, [])

  useEffect(() => () => cancelAnimationFrame(scrollFrameRef.current), [])

  useEffect(() => {
    if (currentIndex >= captureCount && captureCount > 0) {
      setCurrentIndex(captureCount - 1)
    } else if (captureCount === 0) {
      onClose()
    }
  }, [captureCount, currentIndex, onClose])

  // A deletion pulls a slide out of the row from under the scroll offset, which
  // would otherwise leave the next capture sitting half off screen.
  //
  // Load-bearing for the delete's arrival, and this is the only reason it is a
  // *layout* effect: handleDelete moves the index back one and the scroller has
  // to be sitting on that slide before anything is painted. Get it wrong by a
  // frame and the capture that was just deleted flashes back into view under its
  // own exit.
  useLayoutEffect(() => {
    if (captureCount === 0) return
    scrollToIndex(Math.min(currentIndexRef.current, captureCount - 1), false)
  }, [captureCount, scrollToIndex])

  // onLayoutAnimationComplete normally beats this; it is here so a morph that
  // never reports back cannot leave the parallax switched off for good.
  useEffect(() => {
    if (prefersReducedMotion) {
      setIsMorphing(false)
      return
    }
    const timer = setTimeout(() => setIsMorphing(false), MORPH_FALLBACK_MS)
    return () => clearTimeout(timer)
  }, [prefersReducedMotion])

  const currentCapture = captures[currentIndex]
  if (!currentCapture) return null

  const handleSelectCapture = (index: number) => {
    if (index === currentIndex) return
    scrollToIndex(index, !prefersReducedMotion)
  }

  /**
   * The download, on the press.
   *
   * Not after an animation — this used to set a flag and let a 1200ms scan-line
   * animation's completion callback do the download, which meant a button that
   * did nothing for well over a second, and a programmatic anchor click landing
   * outside the user-activation window that permits it.
   *
   * The confirmation is a toast rather than anything drawn over the capture. A
   * motion cue is gone before you can check it, and the thing you actually want
   * to know is whether the file left — which is a statement, not a gesture. It
   * also survives being missed, which is the whole job here.
   */
  const handleDownload = () => {
    if (!currentCapture) return
    downloadCapture(currentCapture)
    playDownloadConfirmation("strong")
    toast.success(currentCapture.kind === "video" ? "Video downloaded" : "Image downloaded")
  }

  /**
   * The delete, on the press.
   *
   * The capture leaves state immediately; the two halves of the motion are drawn
   * over the top of a list that has already changed. The outgoing frame recedes
   * and fades from the app root (see CaptureDismissal) because removing the last
   * capture closes the gallery on this same frame and the exit has to outlive
   * that unmount. The incoming one is stepped to here.
   *
   * Which way the strip steps is the decision worth writing down. The index is
   * moved *back* one rather than left where it is, so what fills the slot is the
   * capture before the deleted one, arriving from the left where it has been
   * sitting all along. Holding the index instead would pull the *next* capture
   * leftwards into the gap, which is the correct thing for a list and the wrong
   * thing for a strip of film: nothing on a strip moves backwards. The oldest
   * capture is the one case with nothing behind it, so there the newer one comes
   * in from the right and the strip steps forward for once.
   *
   * The scroller is jumped onto the new slide rather than scrolled to it — see
   * the re-centring effect. What the eye reads as travel is the card inside that
   * slide crossing its own box; the scroll is already over before the first frame
   * of it is painted.
   */
  const handleDelete = () => {
    if (!currentCapture) return

    const src = stillUrl(currentCapture)
    // Both read before the removal, while this capture is still the one painted.
    const rect = prefersReducedMotion ? undefined : captureRef.current?.getBoundingClientRect()
    const wasLast = captureCount === 1
    const stepsBack = currentIndex > 0

    onDelete(currentCapture.id)
    dismissCapture(src, rect, wasLast)

    // Nothing to step to: the list is empty and the effect above is already
    // closing the gallery.
    if (wasLast) return
    // Above the motion check, because which capture fills the slot is not a
    // motion decision. Reduced motion takes the same step; the scroller just
    // jumps there and no card is ever offset.
    setCurrentIndex(stepsBack ? currentIndex - 1 : 0)
    if (prefersReducedMotion) return
    beginReplacement(stepsBack ? -1 : 1)
  }

  const handleClose = () => {
    // The shared element is bound to the capture the gallery was opened on, and
    // that slide is off screen the moment you swipe away from it — the morph
    // home would fly from a rect nobody can see. So the page draws the collapse
    // of the capture actually in front of you instead.
    const strayed = currentCapture.id !== openedCaptureId && !prefersReducedMotion
    const flight = strayed ? closeFlightFrom(captureRef.current, currentCapture) : undefined
    // Hand the transform back to Framer before the collapse starts, so a gallery
    // closed mid-swipe still morphs from where the capture actually sits.
    setIsMorphing(true)
    onClose(flight)
  }

  const reducedTransition = { duration: 0.15, ease: "easeInOut" as const }
  const morphTransition = prefersReducedMotion ? reducedTransition : galleryMorph

  return (
    <Dialog.Root
      open
      onOpenChange={(open) => {
        if (!open && isPresent) handleClose()
      }}
    >
      <Dialog.Content
        forceMount
        asChild
        aria-modal="true"
        aria-describedby={undefined}
        onOpenAutoFocus={(event) => {
          event.preventDefault()
          closeButtonRef.current?.focus({ preventScroll: true })
        }}
        onCloseAutoFocus={(event) => {
          event.preventDefault()
          const restoreTarget = restoreFocusRef.current
          requestAnimationFrame(() => {
            if (restoreTarget?.isConnected) restoreTarget.focus({ preventScroll: true })
          })
        }}
      >
        {/* z-50 while the gallery owns the screen; below the thumbnail the moment it
            starts handing back.

            The collapse is not drawn by anything in here — the layoutId goes home to
            the thumbnail in the control bar, which sits at z-10. So for as long as
            this box stayed at z-50 it held an opaque backdrop over the top of that
            collapse, and the whole first half of the close played out underneath it:
            the capture vanished on the click frame, the screen went black, and the
            photo only reappeared once the backdrop had dissolved, by which point it
            was most of the way home. Dropping under the thumbnail lets the backdrop
            keep its unhurried fade and puts it where it belongs — behind the picture
            being put away, not on top of it.

            z-0 rather than anything higher because it has to lose to the thumbnail's
            z-10; it still paints over the canvas, which is unpositioned. */}
        <div
      className={cn(
        "fixed inset-0",
        isPresent ? "z-50" : "z-0 pointer-events-none",
      )}
    >
      <Dialog.Title className="sr-only">Captured image gallery</Dialog.Title>
      {/* Background — fades in/out independently.
          In fast, out slow, and deliberately not symmetric. The morph takes
          450ms; a backdrop that took half of that to arrive left the paused
          canvas and the control bar showing around and *through* the growing
          card for the first quarter second, which read as a second, ghosted
          copy of the capture sitting behind the real one. Gone by 120ms it is
          simply the room going dark before the frame is lifted into it. The way
          out keeps the longer fade, where the app returning underneath is the
          point. */}
      <motion.div
        className="fixed inset-0 bg-background"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0, transition: prefersReducedMotion ? reducedTransition : { duration: 0.25, ease: "easeOut" } }}
        transition={prefersReducedMotion ? reducedTransition : { duration: 0.12, ease: "easeOut" }}
      />

      {/* The viewer itself. Dropped the moment the close begins rather than when
          AnimatePresence finally unmounts us. Framer can only hand the layoutId
          back to the thumbnail once the card below is gone, and AnimatePresence
          holds the whole subtree alive until the slowest exit finishes — which
          used to mean a quarter-second of the image sitting fullscreen while the
          backdrop dissolved off it, and only then a collapse. Now the collapse
          starts on the click frame and those fades run alongside it.

          Plain, not a motion element: the shared element is the card around the
          opened capture, further down. Hanging the layoutId on this box meant
          morphing to the viewport, and the viewport is not the shape of the
          photo. */}
      {isPresent && (
        <div className="fixed inset-0 overflow-hidden" onClick={handleClose}>
          {/* Positioning box for the scroller, and nothing more. It used to carry
              a fade — held here rather than on the scroller because Blossom
              writes its own inline `transition` onto that element during a drag
              and would overwrite ours — but whatever once drove it was removed,
              and `imageVisible` sat hardcoded true with a transition that could
              never fire. Put the fade back on this element if it is ever wanted
              again; the reason it cannot live one level down still holds. */}
          <div className="absolute inset-0">
            {/* Every capture is on screen at once, in a real scroll container, so
                the swipe, the trackpad and the arrow keys all come for free — and
                the parallax has a scroll position to read. */}
            <BlossomCarousel
              ref={carouselRef}
              className="gallery-carousel"
              data-morphing={isMorphing ? "true" : undefined}
              data-deleting={replacing ? "true" : undefined}
              onScroll={handleScroll}
              aria-label="Captured frames"
            >
              {captures.map((capture, index) => (
                <div
                  key={capture.id}
                  data-blossom-slide
                  ref={index === initialIndex ? seedScroll : undefined}
                  className="gallery-slide"
                >
                  {/* The arriving capture crosses its own slide, and the slide's
                      overflow:hidden is what makes that read as travel rather
                      than as an image wandering over its neighbours: a slide is
                      exactly one scrollport wide, so clipping to it is clipping
                      to the screen, and the half of the card still off to the
                      left is off the left-hand edge of the phone.

                      Nothing else needs hiding while this runs. The row has
                      already been jumped onto this slide, so its neighbours are
                      exactly one screen out on either side and the scroller
                      clips them — including the slide the deleted capture used to
                      occupy, which is why the strip can step back without the
                      next capture ever showing itself. */}
                  <div
                    className="gallery-card"
                    style={replacing && index === currentIndex ? replacementStyle : undefined}
                  >
                    {/* Every capture is sized to the letterboxed rect it actually
                        occupies rather than stretched across the slide and left
                        to object-contain. Same pixels either way when it is
                        sitting still — but this is the box the morph scales
                        from, and the thumbnail's is in the same proportion, so
                        the flight is a uniform scale with nothing to squash.

                        Alignment is free of the morph, which is worth writing
                        down because it looks like it should not be: where the
                        card lands is just the rect Framer interpolates towards.
                        What keeps black bars from opening up mid-flight is the
                        image overhanging the card until the last frame — 76.5px
                        to 652px against the card's 44px to 652px — and that is
                        a relationship between their heights, not their
                        positions. Centred or top-aligned, the flight is the
                        same. */}
                    <div className="absolute inset-0 flex items-center justify-center">
                      {/* Only the capture we opened from is a shared element — the
                          rest were never on screen to morph from.

                          Two nested layoutIds, and the pair is the whole trick.
                          The card is the aperture: it travels from the 44px circle
                          to the photo's rect, carrying the corner radius down to
                          zero. The image travels from the thumbnail's cover box,
                          which is taller than that circle, to the same photo rect
                          — so it overhangs the card everywhere except at the very
                          end, and the card clips it. The capture fills the
                          aperture the entire way across; what changes is how much
                          of it you are allowed to see. */}
                      {capture.id === openedCaptureId ? (
                        <motion.div
                          layoutId={`gallery-container-${openedCaptureId}`}
                          className="relative overflow-hidden"
                          style={{ borderRadius: 0, width: fitBox.width, height: fitBox.height }}
                          transition={morphTransition}
                          onLayoutAnimationComplete={() => setIsMorphing(false)}
                        >
                          <motion.img
                            ref={index === currentIndex ? setCaptureNode : undefined}
                            layoutId={`gallery-image-${openedCaptureId}`}
                            transition={morphTransition}
                            src={stillUrl(capture) || "/placeholder.svg"}
                            alt={`Captured frame ${index + 1} of ${captureCount}`}
                            className="block"
                            style={{ width: fitBox.width, height: fitBox.height }}
                            draggable={false}
                            onClick={(e) => {
                              e.stopPropagation()
                              if (index === currentIndex && capture.kind === "video") {
                                playback.toggleControls()
                              }
                            }}
                          />
                          {capture.kind === "video" && index === videoIndex && (
                            <GalleryVideo
                              capture={capture}
                              ready={!isMorphing}
                              attachVideo={playback.attachVideo}
                            />
                          )}
                        </motion.div>
                      ) : (
                        // The picture's own box, so a video dropped over it has
                        // something to be `inset-0` against.
                        <div className="relative">
                          <img
                            ref={index === currentIndex ? setCaptureNode : undefined}
                            src={stillUrl(capture) || "/placeholder.svg"}
                            alt={`Captured frame ${index + 1} of ${captureCount}`}
                            className="max-h-full max-w-full"
                            draggable={false}
                            // Still stops the gallery closing on a tap over the
                            // picture; a recording additionally takes the tap as
                            // the touch equivalent of moving a mouse, since
                            // there is no hover here for the bar to read.
                            onClick={(e) => {
                              e.stopPropagation()
                              if (index === currentIndex && capture.kind === "video") {
                                playback.toggleControls()
                              }
                            }}
                          />
                          {capture.kind === "video" && index === videoIndex && (
                            <GalleryVideo capture={capture} ready attachVideo={playback.attachVideo} />
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </BlossomCarousel>
          </div>

        </div>
      )}

      {/* UI controls — fade in after image settles */}
      <motion.div
        className="fixed inset-0 pointer-events-none"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0, transition: { duration: 0.18, delay: 0 } }}
        transition={
          prefersReducedMotion
            ? reducedTransition
            : { duration: 0.18, delay: 0.3, ease: "easeOut" }
        }
      >
        {captureCount > 0 && (
          <div className="absolute inset-x-0 bottom-0">
            {/* The transport sits above the filmstrip, in flow rather than at
                some offset from the bottom — which is the whole reason it is
                stacked here instead of drawn inside the capture like the
                pointer gallery's. The strip's height is its frames plus its own
                `env(safe-area-inset-bottom)` floor, so any number this bar held
                to clear it would be a number that has to be maintained
                alongside it.

                Full-bleed rather than sized to the picture, because on a phone
                it is sitting in the letterbox beneath the capture, not on it. */}
            {showsVideo && (
              <GalleryVideoControls
                playback={playback}
                placement="above-strip"
                className="pointer-events-auto"
              />
            )}
            <GalleryThumbnailStrip
              captures={captures}
              currentIndex={currentIndex}
              onSelect={handleSelectCapture}
              orientation="horizontal"
            />
          </div>
        )}

        {captureCount > 0 && (
          <Button
            ref={closeButtonRef}
            onClick={(e) => { e.stopPropagation(); handleClose() }}
            variant="ghost"
            size="icon"
            className={cn("absolute top-4 right-4 size-11", galleryButtonClass)}
            aria-label="Close gallery"
          >
            <X className="size-4" strokeWidth={1.7} />
          </Button>
        )}

        {currentCapture && (
          <>
            {/* No prev/next arrows here, deliberately. Paging is the swipe — the
                carousel is a real scroll container, so the finger is already the
                primary control and the thumbnail rail below is the direct one.
                A pair of chevrons pinned over the middle of the capture only
                covered the thing being looked at. Desktop has none either; it
                pages with the wheel, the arrow keys and its own rail. */}
            {captureCount > 0 && (
              <div className="absolute top-4 left-4 flex gap-2">
                <Button
                  onClick={(e) => { e.stopPropagation(); handleDelete() }}
                  variant="ghost"
                  size="icon"
                  className={cn("size-11", galleryButtonClass)}
                  aria-label="Delete image"
                >
                  <Trash2 className="size-4" strokeWidth={1.7} />
                </Button>
                <Button
                  onClick={(e) => { e.stopPropagation(); handleDownload() }}
                  variant="ghost"
                  size="icon"
                  className={cn("size-11", galleryButtonClass)}
                  style={{ WebkitTapHighlightColor: "transparent", touchAction: "manipulation" }}
                  aria-label="Download image"
                >
                  <Download className="size-4" strokeWidth={1.7} />
                </Button>
              </div>
            )}
          </>
        )}
      </motion.div>
        </div>
      </Dialog.Content>
    </Dialog.Root>
  )
}
