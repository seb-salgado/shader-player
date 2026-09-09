"use client"

import type { ShaderParams } from "@/lib/shader-uniforms"
import type { Capture } from "@/lib/types"
import { ControlsPanel } from "./controls-panel"
import { CaptureSlot } from "./capture-slot"
import { ShutterButton } from "./shutter-button"
import { ModeTabs, type CaptureMode } from "./mode-tabs"
import { useReducedMotion, type MotionValue } from "framer-motion"
import { controlsSplit, settleEase } from "@/lib/springs"
import { useIsMobile } from "@/hooks/use-mobile"

/** Matches the iOS camera proportions: round thumb, round control. The shutter
 *  owns its own geometry; see SHUTTER_SIZES in ShutterButton. */
const THUMBNAIL_SIZE = 44
const FILTERS_SIZE = 48
/**
 * Half the box — a true circle, written as the real radius. Framer's layout
 * projection interpolates this value during the gallery morph, so an oversized
 * sentinel would hold the corner at an ellipse the whole way down.
 */
const THUMBNAIL_RADIUS = THUMBNAIL_SIZE / 2

interface MobileNavProps {
  onCapture: () => void
  params: ShaderParams
  setParams: (params: ShaderParams) => void
  shaderId: string
  onShaderChange: (shaderId: string) => void
  mode: CaptureMode
  onModeChange: (mode: CaptureMode) => void
  /** Hidden entirely where MediaRecorder is unavailable; see app/page.tsx. */
  videoSupported: boolean
  captures: Capture[]
  isRecording: boolean
  recordingProgress: MotionValue<number>
  onThumbnailClick: (captureIndex: number) => void
  /** Passed straight through to the thumbnail; see CaptureThumbnail. */
  suppressMorph?: boolean
  /**
   * Owned by the page, not by this bar.
   *
   * Opening the controls scales the shader canvas down to make room for them,
   * and the canvas is the page's. The bar renders the button that sets this and
   * the panel that reads it, but it is not where the flag can live.
   */
  controlsOpen: boolean
  onControlsOpenChange: (open: boolean) => void
}

export function MobileNav({
  onCapture,
  params,
  setParams,
  shaderId,
  onShaderChange,
  mode,
  onModeChange,
  videoSupported,
  captures,
  isRecording,
  recordingProgress,
  onThumbnailClick,
  suppressMorph,
  controlsOpen,
  onControlsOpenChange,
}: MobileNavProps) {
  const prefersReducedMotion = useReducedMotion()
  const isMobile = useIsMobile()

  /**
   * The bar's one way of putting a control away: fade it, and step it back 3%.
   *
   * Written once and taken by everything that leaves, because there is more than
   * one reason to leave now — the controls panel taking the screen, and a recording
   * starting — and a bar with two different exits reads as two bars. The scale
   * is what keeps it from being a light switch: nothing here vanishes from full
   * size, it withdraws. Dropped under reduced motion, where the fade alone still
   * carries the change.
   *
   * `settleEase`, the same curve the canvas and the panel move on: the bar is a
   * third of one gesture, not a separate event happening nearby. What is *not*
   * shared is the duration. These controls are 44 and 48px; the canvas is half
   * the screen. Grading duration by mass is what lets the small things read as
   * the receipt for the press while the big ones read as having weight — the bar
   * is done at about 130ms, the canvas is still moving at 190ms.
   *
   * Both numbers went up when the split was recalibrated, and that reaches the
   * recording exit as well. Deliberately: a bar that cleared at one speed for
   * the panel and another for a clip would be the two bars this helper exists to
   * prevent.
   *
   * Nothing reflows on the way out. Every slot in the row is fixed width, so the
   * controls go from their places rather than the row closing over them, and
   * they come back to the same pixels.
   *
   * **Leaving is immediate; coming back waits.** The delay is one-directional
   * and it is the same number whatever put the control away, because the rule is
   * about the bar rather than about the reason: the bar is the destination, so
   * it is the last thing to arrive. Concretely it stops the controls fading up
   * underneath a controls panel that is still fading down — two crossfading
   * planes in the same place — and when a recording ends instead, the beat reads
   * as the clip resolving rather than as lag.
   */
  const hide = (duration: number, hidden: boolean) => ({
    opacity: hidden ? 0 : 1,
    transform: hidden && !prefersReducedMotion ? "scale(0.97)" : "scale(1)",
    pointerEvents: hidden ? ("none" as const) : ("auto" as const),
    transitionDuration: prefersReducedMotion ? "0ms" : `${duration}ms`,
    transitionDelay:
      hidden || prefersReducedMotion ? "0ms" : `${controlsSplit.exit.barDelayMs}ms`,
    transitionTimingFunction: settleEase,
  })

  /**
   * What the two clip-time controls answer to.
   *
   * The iOS camera clears its mode carousel the instant a recording starts, and
   * this is the same idea: for the length of a clip the thumbnail and the mode
   * track are not dimmed versions of themselves, they are gone, and what is left
   * on the bar is the one control the moment is about. The controls panel is the
   * other reason either of them leaves, and hidden is hidden — the two states
   * overlap happily, since the panel stays openable mid-clip on purpose.
   */
  const hiddenForClip = controlsOpen || isRecording

  const latest = captures[captures.length - 1]
  const showThumbnail = isMobile && !!latest

  const handleThumbnailClick = () => {
    const originalIndex = captures.findIndex((c) => c.id === latest.id)
    onThumbnailClick(originalIndex !== -1 ? originalIndex : captures.length - 1)
  }

  return (
    <>
      {/* An opaque strip in the normal flow, so the shader ends where the
          controls begin rather than running underneath them.
          `dark` scopes the dark palette to this subtree regardless of the page
          theme (the variant is `&:is(.dark *)`), so the chrome mattes the
          artwork like a gallery wall instead of competing with it — and the
          controls below stay on semantic tokens rather than hardcoded colours. */}
      <div
        className="dark md:hidden shrink-0 bg-background px-6 pt-4"
        style={{ paddingBottom: "calc(1rem + env(safe-area-inset-bottom, 0px))" }}
      >
        {/* Two rows: the shutter owns the top one, so it stays on the screen's
            centre line without the absolute positioning it used to need, and the
            row below carries the three things you reach for between shots. */}
        <div className="flex flex-col items-center gap-3">
          <ShutterButton
            size="mobile"
            onPress={onCapture}
            mode={mode}
            isRecording={isRecording}
            progress={recordingProgress}
            className="transition-[opacity,transform]"
            style={hide(220, controlsOpen)}
          />

          {/* The outer slots are the same width, which is what keeps the tabs
              optically centred under the shutter. */}
          <div className="flex w-full items-center justify-between">
            {/* z-10 for the gallery exit: the thumbnail is scaled to the full
                viewport inside this row on the way back, and the tabs and the
                filters button would otherwise paint over it. */}
            {/* The footprint is fixed here rather than left to whatever is
                inside, because what is inside depends on useIsMobile — which
                reports false on the first render and only corrects in an
                effect. Sizing this from its contents meant the row's left slot
                was 0 wide for one paint, and `justify-between` started the tabs
                22px left of centre before sliding them over. */}
            {/* Gone for the length of a clip; see hiddenForClip. Where the
                desktop bar dims its thumbnail to 70% and leaves it there, this
                one leaves — the two bars are not the same object. That one is a
                toolbar with a sidebar beside it and a row of controls that stay
                put; this one is the back of a camera, and a camera clears its
                controls when it starts rolling. */}
            <div
              className="relative z-10 shrink-0 transition-[opacity,transform]"
              style={{ ...hide(240, hiddenForClip), width: THUMBNAIL_SIZE, height: THUMBNAIL_SIZE }}
            >
              {showThumbnail && (
                <CaptureSlot
                  capture={latest}
                  previous={captures[captures.length - 2]}
                  width={THUMBNAIL_SIZE}
                  height={THUMBNAIL_SIZE}
                  radius={THUMBNAIL_RADIUS}
                  onClick={handleThumbnailClick}
                  elevated={false}
                  suppressMorph={suppressMorph}
                  // pointer-events-none above stops a pointer and nothing else;
                  // this is what takes the keyboard and the click sound with it.
                  disabled={isRecording}
                />
              )}
            </div>

            {/* The shader picker used to live here. It moved into the panel when
                the capture mode arrived, because only one track fits between the
                thumbnail and the filters button — and of the two, mode is the one
                that has to be reachable in a single tap: it decides what the
                shutter above it does. The shader is a look, and looks belong with
                the parameters that shape them. */}
            {/* Leaves on the same 240ms and the same curve as the thumbnail,
                which is the whole of why they are one gesture rather than two
                things that happened at once. */}
            <div className="transition-[opacity,transform]" style={hide(240, hiddenForClip)}>
              {videoSupported && (
                <ModeTabs
                  mode={mode}
                  onModeChange={onModeChange}
                  layoutIdPrefix="mobile"
                  size="mobile"
                  // Switching to Image mid-clip would freeze the canvas halfway
                  // through the recording. Kept even though the track is on its
                  // way out — a faded-out control that is still focusable is
                  // worse than a visible one.
                  disabled={isRecording}
                  // But not dimmed with it: that dim is a second opacity curve
                  // under the fade above, and it ran the track out ahead of the
                  // thumbnail it is supposed to leave with.
                  dimWhenDisabled={false}
                />
              )}
            </div>

            <button
              onClick={() => onControlsOpenChange(true)}
              className="flex items-center justify-center rounded-full bg-foreground/[0.06] text-muted-foreground transition-[color,opacity,transform] hoverFine:text-foreground active:scale-[0.97]"
              aria-label="Shader controls"
              style={{ ...hide(240, controlsOpen), width: FILTERS_SIZE, height: FILTERS_SIZE }}
            >
              <span
                aria-hidden
                className="size-5 bg-current"
                style={{
                  WebkitMask: "url(/filter.svg?v=2) center / contain no-repeat",
                  mask: "url(/filter.svg?v=2) center / contain no-repeat",
                }}
              />
            </button>
          </div>
        </div>
      </div>

      <ControlsPanel
        params={params}
        setParams={setParams}
        open={controlsOpen}
        onOpenChange={onControlsOpenChange}
        shaderId={shaderId}
        onShaderChange={onShaderChange}
        // The panel stays openable mid-recording — the parameters inside it are
        // live, and that is the point — but the shader picker in it is not.
        isRecording={isRecording}
      />
    </>
  )
}
