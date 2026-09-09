"use client"

import { useEffect, useState, type CSSProperties } from "react"
import {
  motion,
  useMotionValue,
  useReducedMotion,
  useTransform,
  type MotionValue,
} from "framer-motion"
import { spring } from "@/lib/springs"
import { cn } from "@/lib/utils"
import type { CaptureMode } from "./mode-tabs"

/**
 * Ring, gap, fill — the shutter every camera app draws, at the two sizes this
 * app needs it.
 *
 * The proportions are not shared between them and should not be: the desktop
 * shutter sits in the floating bar next to a 44px thumbnail slot and two 44px
 * tab tracks and has to line up with all of them (SLOT_SIZE in
 * lib/toolbar-geometry.ts, SIZES in segmented-tabs.tsx), while the mobile one
 * owns its own row and is sized for a thumb.
 * What *is* shared is the relationship — a ring deliberately heavier than the
 * gap it encloses, because at low contrast a thin ring plus a wide gap reads as
 * two concentric shapes rather than as one shutter.
 *
 * `fill` is written out rather than derived, so the arithmetic is checkable at a
 * glance: 44 − 2×2.5 − 2×1.5 = 36, and 68 − 2×4 − 2×2 = 56. The ring and its gap
 * are the numbers held fixed when the bar's unit changed, not the fill — they are
 * the two that read as weights rather than as size, and thinning either to keep a
 * rounder fill is what turns the shutter back into two concentric shapes.
 *
 * `stop` is the rounded square the fill becomes while recording — the universal
 * stop glyph, at the fraction of the fill that reads as "the same control in a
 * different state" rather than as a new one.
 */
const SHUTTER_SIZES = {
  desktop: { size: 44, ring: 2.5, fill: 36, stop: 15, stopRadius: 4.5 },
  mobile: { size: 68, ring: 4, fill: 56, stop: 24, stopRadius: 7 },
} as const

/** How long the resting ring takes to hand over to the progress track. */
const RING_FADE_MS = 120

/** The track's weight against the arc's. Opacity, not hue — there is no hue here. */
const TRACK_OPACITY = 0.3

/** How far the fill retreats under a press. Matches the `scale-90` photo mode still uses. */
const PRESS_SCALE = 0.9

/**
 * The press, deliberately slower than the press affordance it replaced.
 *
 * `spring.fast` settles in about 70ms, which is shorter than any human click —
 * so the fill always reached the pressed size and *stopped dead* before the
 * finger came up, and the release then had to accelerate the glyph change from
 * zero. Measured at 0 px/s for the ~30ms before release, with the run-in after
 * it peaking near 400. Two velocity peaks with a full stop between them is what
 * reads as two staged movements, even with no frame dropped anywhere.
 *
 * At this duration a normal press is released mid-flight, so the spring is still
 * carrying speed when the target changes and the glyph change continues the
 * press rather than restarting after it. A deliberate long hold still settles —
 * correctly, since holding is a state, not a stage.
 *
 * The dip is 10% of the fill either way; only the time it is allowed to take
 * changed, so nothing about the shape of the press moved.
 */
const PRESS_SPRING = { type: "spring", duration: 0.34, bounce: 0 } as const

/**
 * How far into the glyph change a press travels before the finger comes up.
 *
 * A third is enough for the press to read as the start of the morph rather than
 * as a dip that happens to point the same way, and little enough that letting go
 * still leaves the majority of the movement to the release. Above about half the
 * press stops looking like a press and starts looking like the change already
 * happened, which makes cancelling it by dragging away a surprise.
 */
const PRESS_TOWARD = 1 / 3

interface ShutterButtonProps {
  onPress: () => void
  /**
   * Which press this is. Image mode's is momentary — the fill dips and returns.
   * Video mode's is a toggle: the same press that dips the fill also changes
   * what the fill *is*, so the two cannot be separate animations. See the fill.
   */
  mode: CaptureMode
  size?: keyof typeof SHUTTER_SIZES
  /** Drives the glyph and the ring. */
  isRecording?: boolean
  /** 0 → 1 across the recording cap. Ignored unless recording. */
  progress?: MotionValue<number>
  ariaLabel?: string
  /** The mobile bar hides its controls behind the sheet with opacity/transform. */
  style?: CSSProperties
  className?: string
}

/**
 * The shutter.
 *
 * One component for both bars, unified on `--shutter-ink`. That token resolves
 * to `var(--foreground)` in dark (app/globals.css) and the mobile bar is pinned
 * dark at every width, so the mobile shutter is pixel-identical to the
 * hardcoded `border-foreground` it replaced; only the light desktop shutter
 * takes the token's deliberate pullback from full-strength ink.
 *
 * **The press shrinks the fill, not the button.** On a real camera the ring is
 * part of the body and only the button travels; scaling both would read as the
 * whole shutter assembly shrinking into the bar.
 *
 * **The chrome is ink; only the fill takes a colour.** The ring, the track and
 * the arc are all `currentColor` off the button, so they move together on
 * `--shutter-ink` exactly as before. The fill names its own colour instead, and
 * that is the whole of the split: the ring is the camera body and a body does
 * not change colour, the fill is the button and the button is what the mode
 * acts on. Tinting the ring as well would put the red on the one element that
 * also has to read as a *progress* track for fifteen seconds, and a red arc
 * running down a red ring is a worse clock than an ink one.
 *
 * Both halves keep the /90 hover — each on its own colour — which is the same
 * pullback every other solid control in here uses. It lands the right way round
 * in both themes for the same reason it always did: /90 is 10% of the surface
 * behind it, so the light bar washes its colour up and the dark bar settles its
 * colour down, red or ink. The fill needs `groupHoverFine:` rather than
 * `hoverFine:` because it is a 36px target inside a 44px one; see the variant in
 * app/globals.css.
 *
 * hoverFine, not hover: a touch device would otherwise latch the state on after
 * a tap and hold it there through the capture.
 *
 * **The red belongs to the mode, not to the take.** This used to be drawn
 * achromatically on the argument that a red for a fifteen-second state would be
 * the loudest thing in the app for fifteen seconds. That argument is right about
 * *recording* and wrong about the control: bound to `mode`, the red is not a
 * state that flares up and dies, it is what the shutter is for. Video mode is
 * the app's resting state, so the fill is simply red until you ask for a still —
 * which is the reading every camera has, and the reason nobody has to be taught
 * it.
 *
 * It also does the job the ink version could not. `mode` already changes the
 * shutter's *behaviour* — momentary in image, a toggle in video (see the press
 * below) — and until now the only warning of that was a tab label two elements
 * away. A control that behaves differently should look different before it is
 * pressed, not after.
 *
 * The consequence is that the stop glyph is red too, which is correct rather
 * than incidental: pressing record changes the fill's *shape*, and if it changed
 * the colour at the same moment the press would read as two things happening.
 * The colour is the one thing that holds still across the whole take.
 *
 * Everything else about recording stays achromatic. The ring cross-fades into a
 * progress track, and the elapsed time is legible in the viewfinder, where a
 * camera puts it.
 */
export function ShutterButton({
  onPress,
  mode,
  size = "desktop",
  isRecording = false,
  progress,
  ariaLabel,
  style,
  className,
}: ShutterButtonProps) {
  const geometry = SHUTTER_SIZES[size]
  const prefersReducedMotion = useReducedMotion()

  /**
   * How much of the progress arc is drawn: 0 at the top of a take, 1 at the cap.
   *
   * A mirror of `progress` rather than that value itself, because `progress` is
   * optional — the photo shutter has no clock — and a hook cannot be.
   *
   * Nothing animates it. The arc's length is only ever the recorder's own
   * number, so it can only ever move forward; the entrance and the exit are done
   * with opacity instead, below.
   */
  const ringFill = useMotionValue(0)
  const dashOffset = useTransform(ringFill, (value) => 1 - value)

  useEffect(() => {
    if (!progress) return
    ringFill.set(progress.get())
    return progress.on("change", (value) => ringFill.set(value))
  }, [progress, ringFill])

  /**
   * One curve for all three arcs, so the hand-off reads as a single cross-fade
   * rather than as three rings each doing something.
   *
   * Linear, which is the one place in this app that is right. The house ease-out
   * is a quint, and on a 1 → 0 opacity ramp it spends the first frame dropping
   * the ring to 62% and the rest of the 120ms lingering at nearly nothing — the
   * same failure the shutter flash ran into (lib/springs.ts). Here it is worse
   * than merely wasteful, because a cross-fade is two ramps read against each
   * other: ease both and the pair dips hard in the middle and then crawls, which
   * is a flicker where the whole point was continuity.
   */
  const ringFade = prefersReducedMotion
    ? { duration: 0 }
    : { duration: RING_FADE_MS / 1000, ease: "linear" as const }

  /**
   * Video mode's press, tracked in React so it can be a target of the same
   * spring the glyph uses. One re-render per press — the per-frame values in
   * here are MotionValues and still never reach React.
   */
  const isToggle = mode === "video"
  const [isPressed, setIsPressed] = useState(false)
  const pressHandlers = isToggle
    ? {
        onPointerDown: () => setIsPressed(true),
        onPointerUp: () => setIsPressed(false),
        // The button does not capture the pointer, so a release outside it never
        // reaches onPointerUp. Leaving is the release, as far as the fill knows.
        onPointerLeave: () => setIsPressed(false),
        onPointerCancel: () => setIsPressed(false),
      }
    : undefined

  /**
   * One number for the fill, whatever is acting on it.
   *
   * The press multiplies the glyph's own size rather than scaling the element,
   * so a press and a state change are the same animation on the same property
   * and cannot disagree about where the fill is. Pressing record therefore runs
   * 36 → 32.4 → 15 and never turns around; the version that scaled went
   * 36 → 32.4 → *36* → 15, because releasing the press and becoming the stop
   * glyph were two systems with no knowledge of each other.
   *
   * The radius is multiplied too, which is what a `scale` would have done for
   * free — and the reason to pay for it by hand is the SLOT_RADIUS lesson in
   * lib/toolbar-geometry.ts: with the box animated, a scaled corner would have
   * to be pre-compensated by a number nobody could explain later.
   */
  const glyph = isRecording ? geometry.stop : geometry.fill
  const glyphRadius = isRecording ? geometry.stopRadius : geometry.fill / 2
  const next = isRecording ? geometry.fill : geometry.stop
  const nextRadius = isRecording ? geometry.fill / 2 : geometry.stopRadius

  /**
   * Where the press takes the fill.
   *
   * A press always recedes — that is the affordance, and growing under the
   * finger would read as the button pushing back. But when the press is *also*
   * about to shrink the fill, the two are the same movement and it is a mistake
   * to make them separate ones: dipping to a size the glyph change then has to
   * accelerate away from is what produced the second stage. So the press heads
   * for the glyph it is about to become, and stops a third of the way there.
   *
   * `Math.min` is the whole rule: press toward the outcome, unless the outcome
   * is larger, in which case fall back to the plain dip. Starting a recording
   * takes the first branch and pressing stop takes the second, which is right —
   * pressing stop is followed by the fill *growing*, and there is no way to
   * begin that under the finger without the press pushing back.
   */
  const dip = (from: number, to: number) => Math.min(from * PRESS_SCALE, from + (to - from) * PRESS_TOWARD)
  const fillSize = isPressed ? dip(glyph, next) : glyph
  const fillRadius = isPressed ? dip(glyphRadius, nextRadius) : glyphRadius

  const radius = (geometry.size - geometry.ring) / 2
  const label = ariaLabel ?? (isRecording ? "Stop recording" : "Capture frame")

  return (
    <button
      type="button"
      onClick={onPress}
      {...pressHandlers}
      aria-label={label}
      // Unpositioned, like CaptureThumbnail: the bar around it does the layout.
      className={cn(
        "group relative flex items-center justify-center rounded-full bg-transparent shadow-none outline-none",
        "text-shutter-ink hoverFine:text-shutter-ink/90",
        "cursor-pointer transition-colors duration-150 ease-out motion-reduce:transition-none",
        "focusKey:ring-ring/50 focusKey:ring-[3px]",
        className,
      )}
      style={{ width: geometry.size, height: geometry.size, ...style }}
    >
      {/* The ring, as three arcs rather than a CSS border, so one of them can be
          a progress track. At rest only the first is visible, and it is exactly
          the border it replaced.
          -90° puts zero at twelve o'clock; pathLength normalises the
          circumference to 1 so the dash offset is just the fraction remaining,
          with no 2πr in the component. */}
      <svg
        aria-hidden
        className="absolute inset-0 -rotate-90"
        viewBox={`0 0 ${geometry.size} ${geometry.size}`}
        width={geometry.size}
        height={geometry.size}
        fill="none"
      >
        {/* The ring at rest, and *only* at rest — it is a separate circle from
            the arc, which is the whole point. Sharing one circle meant that
            starting a take had to retract it: 120ms of counter-clockwise sweep
            immediately before a fifteen-second clockwise one, which reads as the
            ring running backwards for a few frames before it catches itself.
            Dissolving it instead leaves the arc free to only ever move forward,
            and the same in reverse on stop. */}
        <motion.circle
          cx={geometry.size / 2}
          cy={geometry.size / 2}
          r={radius}
          stroke="currentColor"
          strokeWidth={geometry.ring}
          initial={false}
          animate={{ opacity: isRecording ? 0 : 1 }}
          transition={ringFade}
        />
        {/* The track the arc runs on. */}
        <motion.circle
          cx={geometry.size / 2}
          cy={geometry.size / 2}
          r={radius}
          stroke="currentColor"
          strokeWidth={geometry.ring}
          initial={false}
          animate={{ opacity: isRecording ? TRACK_OPACITY : 0 }}
          transition={ringFade}
        />
        {/* The arc. It fades in with the track rather than arriving at full
            strength, so the round cap's dot emerges out of the dissolving ring
            instead of appearing on top of it. Held at its final value on the way
            out for the same reason the timecode is (hooks/use-video-recorder.ts):
            rewinding to zero while the exit is still playing is the last thing
            you would want to see of a finished clip. */}
        <motion.circle
          cx={geometry.size / 2}
          cy={geometry.size / 2}
          r={radius}
          stroke="currentColor"
          strokeWidth={geometry.ring}
          // Round caps leave a dot at twelve o'clock when the arc is empty,
          // which reads as "started" rather than as nothing at all.
          strokeLinecap="round"
          pathLength={1}
          strokeDasharray={1}
          initial={false}
          animate={{ opacity: isRecording ? 1 : 0 }}
          transition={ringFade}
          style={{ strokeDashoffset: dashOffset }}
        />
      </svg>

      {/* Circle to rounded square, animated as a box. Safe as layout because the
          parent is a fixed box with flex centring, so nothing outside this
          button can move.

          Image mode keeps the CSS press it has always had. Note that
          `group-active:scale-90` compiles to the independent `scale` property in
          Tailwind v4, which the `transform` transition beside it does not cover
          — so that press is a hard cut in both directions rather than the 100ms
          it reads as. Left alone deliberately; it is what image capture ships
          today, and changing it is a separate decision from this one. */}
      <motion.span
        className={cn(
          "relative block",
          /* 150ms ease-out, which is not a fresh decision — it is the colour
             transition this app already runs, on the button beside this span and
             on the tab labels that trigger it. Worth writing out rather than
             tuning: the mode tab's thumb slides on spring.moderate (160ms,
             bounce 0), so one press moves the thumb and tints the fill over
             essentially one beat. Give the fill its own number and the same
             press becomes two events that happen to be close together.

             ease-out and not `ease`, for the same reason: matching the pair it
             is read against beats matching the general rule for colour.

             Kept under prefers-reduced-motion, unlike the transform beside it. A
             colour crossfade carries no movement to be sick from, and cutting it
             would leave the one state change in this control that has no motion
             to explain it landing as a hard flick. */
          isToggle
            ? "bg-shutter-record groupHoverFine:bg-shutter-record/90 [transition:background-color_150ms_ease-out]"
            : "bg-shutter-ink groupHoverFine:bg-shutter-ink/90 group-active:scale-90 [transition:transform_100ms_ease-out,background-color_150ms_ease-out] motion-reduce:[transition:background-color_150ms_ease-out]",
        )}
        initial={false}
        animate={{ width: fillSize, height: fillSize, borderRadius: fillRadius }}
        transition={prefersReducedMotion ? { duration: 0 } : isPressed ? PRESS_SPRING : spring.moderate}
      />
    </button>
  )
}
