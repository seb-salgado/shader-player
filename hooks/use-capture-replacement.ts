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
 * How the capture taking a deleted one's place gets into the slot.
 *
 * `slide` is the touch gallery, and it is true there: the captures lie side by
 * side in a horizontal scroller, the neighbour genuinely is one screen out, and
 * swiping between them is the whole interaction. A capture crossing the screen
 * is the strip stepping, which is a thing the user has done by hand many times
 * before they ever delete anything.
 *
 * `step` is the desktop viewer, which is not a strip and so does not travel a
 * screen. It is one slot with a vertical rail beside it, and that rail runs
 * oldest to newest down the page — so the capture filling the slot is a
 * neighbour on a line with a direction on screen, and it enters from the side of
 * that line it actually lives on. A dozen pixels, not a viewport: the wheel
 * hard-cuts between captures, so this slot has never scrolled and a delete is
 * not the place to start.
 *
 * It used to be a scale — the card behind coming forward — which was true while
 * the rail put the newest capture on top and the viewer could be read as a stack
 * of photographs. The rail is a timeline now, and on a timeline nothing is
 * behind anything. See galleryEffects.stepPx.
 */
export type Entrance = "slide" | "step"

/**
 * The capture that takes a deleted one's place, entering the slot it left.
 *
 * Both galleries drive their entrance off this, on different elements and on
 * different axes: the desktop viewer translates the wrapper around the single
 * image it renders, the touch gallery translates the card of the slide the
 * scroller has just been jumped onto. What they share is the awkward part — a
 * transition needs a *from* to leave, and setting the offset and the target in
 * one commit gives it nothing to interpolate between, so the capture simply
 * appears in place. Two commits: the first paints the from-state with no
 * transition on it at all, the second lets it come home.
 *
 * A transition and not a keyframe, deliberately. Delete is a button you can hit
 * twice in 300ms, and keyframes restart from zero where a transition retargets
 * from wherever the capture had got to.
 */
export function useCaptureReplacement(entrance: Entrance) {
  const [arrival, setArrival] = useState<{ key: number; from: EntranceFrom } | null>(null)
  const [settled, setSettled] = useState(false)

  const durationMs = entrance === "step" ? galleryEffects.stepMs : galleryEffects.replaceMs

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
   * `from` is the side the capture comes from, and both entrances have one now.
   * The reveal this replaced did not: it was the card behind coming forward,
   * which is the same move whichever capture fills the slot — and that was
   * exactly its problem once the rail started running in time order.
   */
  const beginReplacement = useCallback((from: EntranceFrom = -1) => {
    setSettled(false)
    setArrival({ key: nextKey++, from })
  }, [])

  const replacementStyle: CSSProperties | undefined = !arrival
    ? undefined
    : entrance === "step"
      ? settled
        ? {
            transform: "translateY(0)",
            transition: `transform ${galleryEffects.stepMs}ms ${galleryEffects.dismissEase}`,
          }
        // Pixels, not percentages: the travel is a statement about the rail's
        // axis, not a fraction of the capture — and the capture's height is
        // whatever the letterbox made it, which has nothing to do with it.
        : { transform: `translateY(${arrival.from * galleryEffects.stepPx}px)`, transition: "none" }
      : settled
        ? {
            transform: "translateX(0)",
            transition: `transform ${galleryEffects.replaceMs}ms ${galleryEffects.replaceEase}`,
          }
        // Percentages, not pixels: a slide is always exactly one screen of
        // travel, and the element that has to cross it is sized by its slide.
        : { transform: `translateX(${arrival.from * 100}%)`, transition: "none" }

  return { replacing: arrival !== null, replacementStyle, beginReplacement }
}
