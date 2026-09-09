"use client"

import { useCallback, useEffect, useState, type CSSProperties } from "react"
import { galleryEffects } from "@/lib/springs"

let nextKey = 0

/**
 * Which side the arriving capture comes from: −1 is the side the *earlier*
 * capture lives on, +1 the later one.
 *
 * One sign for both surfaces, because both lay their captures out oldest first
 * — so −1 resolves to the left of the touch strip and to the top of the desktop
 * rail. A delete steps back, so it is nearly always −1; the exception is
 * deleting the oldest capture, which has nothing before it and is replaced from
 * +1 instead.
 */
export type EntranceFrom = -1 | 1

/**
 * The axis the arriving capture crosses — the only thing that differs between
 * the two galleries.
 *
 * `x` is the touch strip: the captures lie side by side in a horizontal
 * scroller, the neighbour genuinely is one screen out, and swiping between them
 * is the whole interaction.
 *
 * `y` is the desktop viewer, whose rail runs oldest to newest *down* the page —
 * so the capture filling the slot is a neighbour on a vertical line, and it
 * comes in over the top edge because that is where it lives.
 *
 * Same slide either way — same travel, same duration band, different curve,
 * because the desktop slot never scrolls and so takes an entrance rather than a
 * crossing. What each one crosses is a
 * full slot — 100% of the element's own box — so the arriving capture is off
 * screen at the start and there is never a moment of it half-parked in the
 * letterbox. See galleryEffects.replaceYMs for why the vertical one is longer.
 *
 * This replaced a 28px "step" on desktop, which had the axis and the direction
 * right and the distance wrong: too small to be seen under the ghost, so it had
 * to be delayed until the ghost was gone, which made a delete two beats instead
 * of one.
 */
export type Axis = "x" | "y"

/**
 * The capture that takes a deleted one's place, entering the slot it left.
 *
 * Both galleries drive their entrance off this, on different elements: the
 * desktop viewer translates the wrapper around the single image it renders, the
 * touch gallery translates the card of the slide the scroller has just been
 * jumped onto. What they share is the awkward part — a transition needs a *from*
 * to leave, and setting the offset and the target in one commit gives it nothing
 * to interpolate between, so the capture simply appears in place. Two commits:
 * the first paints the from-state with no transition on it at all, the second
 * lets it come home.
 *
 * A transition and not a keyframe, deliberately. Delete is a button you can hit
 * twice in 300ms, and keyframes restart from zero where a transition retargets
 * from wherever the capture had got to.
 */
export function useCaptureReplacement(axis: Axis) {
  const [arrival, setArrival] = useState<{ key: number; from: EntranceFrom } | null>(null)
  const [settled, setSettled] = useState(false)

  const durationMs = axis === "y" ? galleryEffects.replaceYMs : galleryEffects.replaceXMs
  // Different curves, and not for the axis's sake: the touch card is a strip
  // stepping across the screen, the desktop capture is entering a slot that
  // never scrolls. See galleryEffects.replaceYEase.
  const ease = axis === "y" ? galleryEffects.replaceYEase : galleryEffects.replaceXEase

  useEffect(() => {
    if (!arrival) return
    const start = requestAnimationFrame(() => setSettled(true))
    // Cleared rather than left at rest, so the element goes back to owning its
    // own transform the moment the entrance is over — on the touch gallery that
    // is the scroll-driven parallax getting its card back.
    const end = window.setTimeout(() => setArrival(null), durationMs + 60)
    return () => {
      cancelAnimationFrame(start)
      window.clearTimeout(end)
    }
  }, [arrival, durationMs])

  /**
   * `from` is the side the capture comes from. The reveal this replaced on
   * desktop did not have one: it was the card behind coming forward, which is
   * the same move whichever capture fills the slot — and that was exactly its
   * problem once the rail started running in time order.
   */
  const beginReplacement = useCallback((from: EntranceFrom = -1) => {
    setSettled(false)
    setArrival({ key: nextKey++, from })
  }, [])

  // Percentages, not pixels: the travel is one slot, and the element that has to
  // cross it is the one being sized — the slide on touch, the viewer box on
  // desktop. Nothing here has to know how big either of them is.
  const translate = (offset: number) =>
    axis === "y" ? `translateY(${offset}%)` : `translateX(${offset}%)`

  const replacementStyle: CSSProperties | undefined = !arrival
    ? undefined
    : settled
      ? {
          transform: translate(0),
          transition: `transform ${durationMs}ms ${ease}`,
        }
      : { transform: translate(arrival.from * 100), transition: "none" }

  return { replacing: arrival !== null, replacementStyle, beginReplacement }
}
