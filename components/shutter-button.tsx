"use client"

import { useEffect, type CSSProperties } from "react"
import {
  animate,
  motion,
  useMotionValue,
  useReducedMotion,
  useTransform,
  type MotionValue,
} from "framer-motion"
import { spring } from "@/lib/springs"
import { cn } from "@/lib/utils"

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

/** How long the ring takes to empty before it starts filling. */
const RING_EMPTY_MS = 120

/** The track's weight against the arc's. Opacity, not hue — there is no hue here. */
const TRACK_OPACITY = 0.3

interface ShutterButtonProps {
  onPress: () => void
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
 * **The press scales the fill, not the button.** On a real camera the ring is
 * part of the body and only the button travels; scaling both would read as the
 * whole shutter assembly shrinking into the bar.
 *
 * Ring and fill are both `currentColor`, which is what keeps them moving
 * together: the hover pulls the ink back to 90% on the button and both follow.
 * The same /90 every other solid control in here uses, and it lands the right
 * way round in both themes because the palette is achromatic — 90% of the ink is
 * 10% of the surface behind it, so light mode's dark shutter lifts toward the
 * bar and dark mode's near-white one settles into it.
 *
 * hoverFine, not hover: a touch device would otherwise latch the state on after
 * a tap and hold it there through the capture.
 *
 * **Recording is drawn achromatically**, which is the one place this departs
 * from every camera ever made. There is no red in this design to be coherent
 * with, so introducing one for a fifteen-second state would make it the loudest
 * thing in the app. Instead the ring — already present, already the camera body
 * — empties and refills as a progress track, and the fill becomes the stop
 * glyph. The elapsed time is legible in the viewfinder, where a camera puts it.
 */
export function ShutterButton({
  onPress,
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
   * How much of the ring is drawn: 1 is the solid ring at rest, 0 is empty.
   *
   * Its own value rather than reading `progress` directly, because the ring has
   * to *empty* before it fills. Watching it drain and come back is what makes
   * the same ring read as a progress track without anything being added to the
   * shutter — and jumping straight to zero would just look like the ring
   * disappeared.
   */
  const ringFill = useMotionValue(1)
  const dashOffset = useTransform(ringFill, (value) => 1 - value)

  useEffect(() => {
    if (!isRecording) {
      if (prefersReducedMotion) {
        ringFill.set(1)
        return
      }
      const controls = animate(ringFill, 1, { duration: RING_EMPTY_MS / 1000, ease: "easeOut" })
      return () => controls.stop()
    }

    // Only follow progress once the ring has drained, or the two would fight
    // over the same value for the first eighth of a second.
    let following = prefersReducedMotion
    let controls: ReturnType<typeof animate> | undefined
    if (prefersReducedMotion) {
      ringFill.set(0)
    } else {
      controls = animate(ringFill, 0, {
        duration: RING_EMPTY_MS / 1000,
        ease: "easeOut",
        onComplete: () => {
          following = true
        },
      })
    }
    const unsubscribe = progress?.on("change", (value) => {
      if (following) ringFill.set(value)
    })
    return () => {
      controls?.stop()
      unsubscribe?.()
    }
  }, [isRecording, prefersReducedMotion, progress, ringFill])

  const radius = (geometry.size - geometry.ring) / 2
  const label = ariaLabel ?? (isRecording ? "Stop recording" : "Capture frame")

  return (
    <button
      type="button"
      onClick={onPress}
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
      {/* The ring, as two arcs rather than a CSS border, so one of them can be a
          progress track. At rest the arc is a complete circle at full strength
          over an invisible track, which is the border it replaced.
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
        <motion.circle
          cx={geometry.size / 2}
          cy={geometry.size / 2}
          r={radius}
          stroke="currentColor"
          strokeWidth={geometry.ring}
          initial={false}
          animate={{ opacity: isRecording ? TRACK_OPACITY : 0 }}
          transition={prefersReducedMotion ? { duration: 0 } : { duration: RING_EMPTY_MS / 1000 }}
        />
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
          style={{ strokeDashoffset: dashOffset }}
        />
      </svg>

      {/* Circle to rounded square, and the *box* is animated rather than a
          scale — the SLOT_RADIUS lesson in lib/toolbar-geometry.ts: a scale
          would paint the radius scaled too, so the corner would have to be
          pre-compensated by a number nobody could explain later. Safe as layout
          because the parent is a fixed box with flex centring, so nothing
          outside this button can move.

          The press affordance stays a CSS transform on the same element, which
          does not collide: Framer is driving width, height and border-radius
          here, not transform. */}
      <motion.span
        className="relative block bg-current group-active:scale-90 [transition:transform_100ms_ease-out] motion-reduce:transition-none"
        initial={false}
        animate={{
          width: isRecording ? geometry.stop : geometry.fill,
          height: isRecording ? geometry.stop : geometry.fill,
          borderRadius: isRecording ? geometry.stopRadius : geometry.fill / 2,
        }}
        transition={prefersReducedMotion ? { duration: 0 } : spring.moderate}
      />
    </button>
  )
}
