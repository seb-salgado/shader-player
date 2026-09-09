"use client"

import { useRef } from "react"
import { motion, useReducedMotion } from "framer-motion"
import { type Capture, stillUrl } from "@/lib/types"
import { captureFlash, galleryMorph, spring } from "@/lib/springs"

export const THUMBNAIL_RADIUS = 8

/**
 * object-cover written out as a real box rather than left to the paint step.
 *
 * The gallery morph moves the <img> to the letterboxed rect it occupies
 * full-screen, and Framer drives that with a transform — so whatever aspect
 * ratio the element's own box has here is the one it is scaled *from*. A square
 * box (44×44) reaching a 9:19.5 rect means scaleX and scaleY differ by more than
 * 2×, and object-cover cannot undo that: it is resolved once at layout, not per
 * frame. The capture spent the first half of its flight visibly squashed.
 *
 * Sizing the box to the capture's own aspect and letting the round parent clip
 * it gives the identical cover framing with the two ends already in proportion,
 * so the morph is a plain uniform scale.
 *
 * A capture taken before the canvas has been sized comes back 0×0, and the ratio
 * with it: falling back to the box means a degenerate capture is still laid out,
 * rather than writing NaN into the style.
 *
 * Shared with the outgoing layer in CaptureSlot, which has to frame its picture
 * identically or the swap would visibly re-crop.
 */
export function coverBox(capture: Capture, width: number, height: number) {
  const ratio = capture.width / capture.height
  const aspect = Number.isFinite(ratio) && ratio > 0 ? ratio : width / height
  const isWider = aspect > width / height
  return {
    width: isWider ? height * aspect : width,
    height: isWider ? height : width / aspect,
  }
}

interface CaptureThumbnailProps {
  capture: Capture
  width: number
  height: number
  onClick: () => void
  /**
   * Lift off the backdrop. Wanted on desktop, where the thumbnail floats over
   * the shader; unwanted in the mobile bar, which is already an opaque surface.
   */
  elevated?: boolean
  /**
   * The true corner radius — half the box for a circle, not an oversized
   * sentinel. Framer interpolates this during the gallery morph, so a value the
   * browser would merely clamp at paint keeps the corner elliptical the whole
   * way across.
   */
  radius?: number
  /**
   * Drops out of the shared-element pair for as long as it is set.
   *
   * The page raises this when the gallery is dismissed from a capture other than
   * the one it was opened on. The morph home would then be drawing the wrong
   * photograph — this thumbnail's, rather than the one on screen — so
   * GalleryCloseFlight draws the collapse instead, and this has to be out of the
   * layoutId stack while it does.
   *
   * Suppressing it *here* rather than in the gallery is the load-bearing part:
   * when a member of the stack unmounts, the member left behind resumes from its
   * box, which is precisely the mechanism that draws the real close. Leaving
   * this one registered would have it fly home on its own underneath the flight.
   * Taken out here, the gallery's node unmounts into an empty stack and nothing
   * animates.
   *
   * Only ever read on mount, which is why CaptureSlot keys this component on it:
   * Framer takes layoutId once, when it builds the projection node, and never
   * looks at the prop again. Handing it undefined on a live element changes
   * nothing at all — the node stays in the stack and flies home regardless.
   */
  suppressMorph?: boolean
  /**
   * Inert and out of the tab order, for as long as a recording is running.
   *
   * The `pointer-events-none` on the slot around it stops a pointer and nothing
   * else: the button stayed focusable, and Enter on it played the confirm click
   * in full before the page's own guard silently swallowed the open. Only the
   * attribute takes the keyboard and the sound with it.
   */
  disabled?: boolean
  /**
   * Whether to fade and settle into place on mount.
   *
   * True for a capture that has just been taken, which is what the arrival is
   * for; false when this is only being remounted to leave the layoutId stack,
   * where replaying it would make the thumbnail disappear and return for no
   * reason the user could name.
   */
  animateArrival?: boolean
}

/**
 * The captured-image thumbnail itself, without any positioning. The mobile bar
 * and the desktop corner render this at different sizes — but only ever one at
 * a time, since two elements sharing a layoutId would break the gallery morph.
 */
export function CaptureThumbnail({
  capture,
  width,
  height,
  onClick,
  elevated = true,
  radius = THUMBNAIL_RADIUS,
  suppressMorph = false,
  disabled = false,
  animateArrival = true,
}: CaptureThumbnailProps) {
  const prefersReducedMotion = useReducedMotion()
  const pressRef = useRef<HTMLDivElement>(null)

  const handleClick = () => {
    // The press affordance below is a CSS transform on an *ancestor* of the
    // shared element, and this click is the one moment those two things meet:
    // Framer measures the thumbnail on this very frame, while the 150ms release
    // is still easing 0.97 back to 1. The projection transform it derives is
    // relative to whatever the element renders at, so a box measured 3% small
    // makes the thumbnail's half of the crossfade fly 3% *large* for the whole
    // morph — its edges showing as a rim around the gallery's copy, through a
    // backdrop that has not finished fading in.
    //
    // So the press is put back at rest for the single frame the morph is
    // measured on, and handed straight back to the stylesheet. Nothing about how
    // the press looks changes: the pointer is already up by the time this runs,
    // this reset and the gallery's mount land in the same commit so there is no
    // frame in which the snap is painted on its own, and every press that does
    // not open the gallery keeps the full eased release.
    const press = pressRef.current
    if (press) {
      press.style.transition = "none"
      press.style.transform = "none"
      // Read it back, or the two writes above are still queued when Framer
      // measures.
      press.getBoundingClientRect()
    }

    onClick()

    requestAnimationFrame(() => {
      if (!press) return
      press.style.transition = ""
      press.style.transform = ""
    })
  }

  const transition = prefersReducedMotion ? { duration: 0 } : galleryMorph
  const morphs = !prefersReducedMotion && !suppressMorph

  const cover = coverBox(capture, width, height)

  return (
    // The arrival, one layer further out again, and for the mirror of the
    // reason below: the press affordance drives transform from a CSS class, and
    // Framer writes transform inline. Sharing an element, the two overwrite each
    // other. Both call sites key this component on the image id, which is what
    // remounts it and replays `initial` for every capture rather than only the
    // first.
    //
    // Centred absolutely rather than sitting in flow so the desktop slot can
    // grow around it. Left in flow it would be pinned to the slot's left edge
    // at full width and spill straight over the shader tabs, which is what it
    // used to do. The flash masks the slot making room; the capture itself only
    // settles from 0.95 so it always enters with a perceptible physical shape.
    //
    // Negative margins for the centring, not a translate: Framer owns the
    // transform on this element and a -50% translate would have to be carried
    // through every keyframe of the scale.
    //
    <motion.div
      initial={
        prefersReducedMotion || !animateArrival
          ? false
          : { transform: "scale(0.95)", opacity: 0 }
      }
      animate={{ transform: "scale(1)", opacity: 1 }}
      // Held until the flash starts lifting; see captureFlash.holdEndMs.
      transition={
        prefersReducedMotion
          ? { duration: 0 }
          : { ...spring.moderate, delay: captureFlash.holdEndMs / 1000 }
      }
      style={{
        position: "absolute",
        left: "50%",
        top: "50%",
        marginLeft: -width / 2,
        marginTop: -height / 2,
        width,
        height,
      }}
    >
      {/* The press affordance sits out here rather than on the element below,
          because that element is the one Framer drives: it writes an inline
          transform on every frame of the gallery morph, and a CSS transition on
          transform/scale would re-ease each of those writes, smearing the spring
          into mush. Scaling from outside keeps the whole circle shrinking
          together — scaling from inside would pull the image off the clipped
          edge instead. */}
      <div
        ref={pressRef}
        className="active:scale-[0.97] transition-transform duration-150 ease-out motion-reduce:transition-none"
        style={{ width, height }}
      >
        <motion.button
          type="button"
          layoutId={morphs ? `gallery-container-${capture.id}` : undefined}
          // What GalleryCloseFlight measures its landing box off. On the
          // thumbnail's own element rather than the slot around it, because this
          // is the box the morph lands on: the radius and the clip are both
          // here.
          data-capture-thumbnail
          disabled={disabled}
          onClick={handleClick}
          className="group relative block cursor-pointer appearance-none overflow-hidden border-0 bg-transparent p-0 text-inherit outline-none focusKey:ring-[3px] focusKey:ring-ring/50"
          style={{
            width,
            height,
            borderRadius: radius,
            boxShadow: elevated ? "0 4px 12px rgba(0, 0, 0, 0.15), 0 1px 3px rgba(0, 0, 0, 0.1)" : "none",
          }}
          transition={transition}
          aria-label="View latest capture"
        >
          {/* Centred by a flex parent rather than by a transform: the image below
              is a projection node, and Framer overwrites its transform on every
              frame of the morph. */}
          <div className="absolute inset-0 flex items-center justify-center">
            {/* Carries its own layoutId so Framer treats it as a projection node and
                cancels the container's scale out of it. Without that the photo is
                stretched by however unevenly the box grows — and a circle reaching a
                landscape viewport grows very unevenly indeed. */}
            <motion.img
              layoutId={morphs ? `gallery-image-${capture.id}` : undefined}
              transition={transition}
              src={stillUrl(capture) || "/placeholder.svg"}
              alt="Latest capture"
              className="max-w-none shrink-0"
              style={{ width: cover.width, height: cover.height }}
            />
          </div>
          <div className="absolute inset-0 bg-white/0 group-hoverFine:bg-white/10 transition-colors duration-150 pointer-events-none" />
        </motion.button>
      </div>
    </motion.div>
  )
}
