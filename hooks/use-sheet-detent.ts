"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { animate, useMotionValue, useMotionValueEvent, useReducedMotion } from "framer-motion"
import type { AnimationPlaybackControls } from "framer-motion"

import { controlsSplit } from "@/lib/springs"

export type SheetDetent = "split" | "tall"

/**
 * Where each detent parks the sheet, in viewport-relative units rather than in
 * resolved pixels.
 *
 * The sheet's box is pinned at the *tall* position and never moves; what moves
 * is a transform that pushes it back down to the split. So the split's offset is
 * the distance between the two — the viewport's own `openFraction`, less the
 * fixed margin the tall detent leaves above it.
 *
 * Written back at the end of every settle, and that is the point. A resolved px
 * value is only correct for the viewport it was measured in, so the next time
 * Safari's URL bar slides, the resting position would sit a few pixels off the
 * edge the panel's own CSS derives. Handing the property back to a `calc` in dvh
 * re-anchors it to the same number, and the drift cannot accumulate.
 */
const REST_Y: Record<SheetDetent, string> = {
  split: `calc(${controlsSplit.openFraction * 100}dvh - ${controlsSplit.tallTopPx}px)`,
  tall: "0px",
}

/** How far the finger travels before this is a drag rather than a tap. */
const DRAG_THRESHOLD_PX = 6

/** Past this, the release goes wherever it was thrown regardless of position. */
const FLICK_PX_PER_MS = 0.5

/**
 * How much of a pull past a detent actually lands.
 *
 * The split is the floor: dragging below it does not dismiss, because closing
 * runs a three-party choreography — panel out, canvas back up, bar back in — that
 * a gesture has no way into. But the pull still has to be answered. Resistance
 * rather than a hard stop, because a sheet that simply refuses to move reads as
 * broken, and one that gives a little and comes back reads as the end of its
 * range.
 */
const EDGE_RESISTANCE = 0.4

/**
 * The mobile controls panel's two resting positions, and the gesture between
 * them.
 *
 * Everything the drag touches is a CSS custom property written straight to the
 * element, never state: this fires on every pointermove and every animation
 * frame, and a setState here would re-render every parameter group and every
 * slider in the panel in order to move one transform. The same reasoning
 * ControlsPanel gives for the scrim, and RecordingTimer for taking a MotionValue
 * instead of a prop.
 *
 * The settled detent *is* state, because three things depend on which one we are
 * at rather than on where the sheet currently is: the grabber's `aria-expanded`,
 * the scroller's slack, and what a tap on the grabber means next.
 *
 * Takes `open` only to reset itself; see the effect below for why it cannot be
 * left to unmounting.
 */
export function useSheetDetent(open: boolean) {
  const sheetRef = useRef<HTMLDivElement>(null)
  const [detent, setDetent] = useState<SheetDetent>("split")
  const prefersReducedMotion = useReducedMotion()

  const y = useMotionValue(0)
  const travelRef = useRef(0)
  const animationRef = useRef<AnimationPlaybackControls | null>(null)
  const dragRef = useRef<{
    startY: number
    startOffset: number
    moved: boolean
    lastY: number
    lastTime: number
    velocity: number
  } | null>(null)

  /**
   * Back to the split whenever the panel closes.
   *
   * Not something a fresh mount does for us, and that is the trap: Radix
   * unmounts the *portal's contents* on close, but ControlsPanel itself is
   * rendered unconditionally by MobileNav and never goes away — so this hook's
   * state outlives the element it describes. Left alone, the panel reopens
   * claiming a detent that the newly created sheet, whose custom properties are
   * seeded for the split, is not at: the slack says tall, the transform says
   * split, and the last rows of the list are unreachable.
   *
   * Resetting rather than persisting is also the behaviour the design wants. The
   * lifted detent is an escalation, asked for by grabbing the panel; carrying it
   * over into the next session of the panel would be answering a question the
   * user has not asked yet.
   */
  useEffect(() => {
    if (open) return
    animationRef.current?.stop()
    animationRef.current = null
    travelRef.current = 0
    y.jump(0)
    setDetent("split")
  }, [open, y])

  /** The gap between the detents in px, from the sheet's own box. */
  const measureTravel = useCallback(() => {
    const sheet = sheetRef.current
    if (!sheet) return 0
    // Recovered from the sheet rather than read off the window, so the finger is
    // measured against the same box the CSS laid out. offsetHeight is the
    // viewport less tallTopPx by construction — the sheet fills a box that is
    // `top: tallTopPx; bottom: 0` — so adding it back gives the viewport, and
    // the split sits openFraction into that, tallTopPx above the sheet's origin.
    const viewport = sheet.offsetHeight + controlsSplit.tallTopPx
    return viewport * controlsSplit.openFraction - controlsSplit.tallTopPx
  }, [])

  // Position, and nothing else. The sheet is the same colour and the same shape
  // at both detents, so the drag has exactly one property to write — which is
  // also what keeps the whole gesture on the compositor: nothing repaints while
  // the finger is down.
  useMotionValueEvent(y, "change", (value) => {
    const sheet = sheetRef.current
    if (!sheet) return
    sheet.style.setProperty("--sheet-y", `${value}px`)
  })

  /**
   * Park the sheet on a detent, and hand --sheet-y back to its canonical,
   * viewport-relative value.
   *
   * `setDetent` fires here, at the *start* of the settle rather than when the
   * spring lands, and that ordering is the mechanism rather than a detail. It is
   * what flips the scroller's slack — and on the way up, dropping the slack
   * shrinks scrollHeight and clamps scrollTop by up to a full travel. Doing it
   * now puts that clamp in the same frames as the sheet rising by the same
   * distance, so the two cancel: the row being read stays exactly where it is,
   * and the new room opens above it. Doing it on completion would slide the whole
   * list after the motion had already stopped.
   */
  const settle = useCallback(
    (target: SheetDetent, velocityPxPerMs = 0) => {
      const sheet = sheetRef.current
      if (!sheet) return

      animationRef.current?.stop()
      animationRef.current = null
      setDetent(target)

      const travel = travelRef.current || measureTravel()
      travelRef.current = travel
      const targetY = target === "tall" ? 0 : travel

      const land = () => {
        animationRef.current = null
        sheet.style.setProperty("--sheet-y", REST_Y[target])
      }

      // The drag itself still tracks the finger under reduced motion — direct
      // manipulation is not an animation, and refusing it would just make the
      // sheet unusable. It is only the part the finger is no longer driving that
      // stops moving.
      if (prefersReducedMotion) {
        y.jump(targetY)
        land()
        return
      }

      animationRef.current = animate(y, targetY, {
        ...controlsSplit.detentSpring,
        // Framer works in units per second; the gesture is sampled per ms.
        velocity: velocityPxPerMs * 1000,
        onComplete: land,
      })
    },
    [measureTravel, prefersReducedMotion, y],
  )

  /** The grabber's tap, and its Enter and Space. */
  const toggle = useCallback(() => {
    settle(detent === "split" ? "tall" : "split")
  }, [detent, settle])

  /**
   * Swallow the click a finished drag is about to produce.
   *
   * The header is both the grab surface and the way out, so a drag that ends
   * over the title would otherwise close the panel it had just finished moving.
   * Capture phase, on the header itself: React listens at the root container, so
   * stopping propagation here means the synthetic click is never dispatched at
   * all and the Radix Close inside never hears about it.
   */
  const suppressNextClick = useCallback((header: HTMLElement) => {
    const swallow = (event: MouseEvent) => {
      event.preventDefault()
      event.stopPropagation()
    }
    header.addEventListener("click", swallow, { capture: true, once: true })
    // A drag that ends anywhere but on a clickable child produces no click at
    // all, so the listener has to be able to expire on its own.
    window.setTimeout(() => header.removeEventListener("click", swallow, { capture: true }), 0)
  }, [])

  const onPointerDown = useCallback(
    (event: React.PointerEvent<HTMLElement>) => {
      // Primary pointer only, and never a second finger arriving mid-drag.
      if (!event.isPrimary || dragRef.current) return

      const header = event.currentTarget
      header.setPointerCapture(event.pointerId)

      // Catching the sheet mid-flight is the one case where the MotionValue is
      // authoritative: it holds live pixels. At rest it is not — the resting
      // value on the element is a dvh string the MotionValue never saw — so
      // there the offset comes from the settled detent instead.
      const wasAnimating = animationRef.current !== null
      animationRef.current?.stop()
      animationRef.current = null

      const travel = measureTravel()
      travelRef.current = travel

      const startOffset = wasAnimating ? y.get() : detent === "tall" ? 0 : travel
      y.jump(startOffset)

      dragRef.current = {
        startY: event.clientY,
        startOffset,
        moved: false,
        lastY: event.clientY,
        lastTime: event.timeStamp,
        velocity: 0,
      }

      const handleMove = (moveEvent: PointerEvent) => {
        const drag = dragRef.current
        if (!drag) return

        const delta = moveEvent.clientY - drag.startY
        if (!drag.moved) {
          if (Math.abs(delta) < DRAG_THRESHOLD_PX) return
          drag.moved = true
        }

        const elapsed = moveEvent.timeStamp - drag.lastTime
        if (elapsed > 0) {
          drag.velocity = (moveEvent.clientY - drag.lastY) / elapsed
          drag.lastY = moveEvent.clientY
          drag.lastTime = moveEvent.timeStamp
        }

        // Past either end the pull is answered rather than obeyed. Above `tall`
        // there is nothing left to uncover; below `split` is the floor.
        let next = drag.startOffset + delta
        if (next > travel) next = travel + (next - travel) * EDGE_RESISTANCE
        else if (next < 0) next *= EDGE_RESISTANCE
        y.set(next)
      }

      const handleEnd = () => {
        const drag = dragRef.current
        dragRef.current = null
        header.removeEventListener("pointermove", handleMove)
        header.removeEventListener("pointerup", handleEnd)
        header.removeEventListener("pointercancel", handleEnd)
        if (header.hasPointerCapture(event.pointerId)) {
          header.releasePointerCapture(event.pointerId)
        }
        if (!drag) return

        // A tap. Leave the sheet alone, and let the click through to whichever
        // control was under the finger.
        if (!drag.moved) return

        suppressNextClick(header)

        // Velocity first, position second. A short, fast flick means the same
        // thing as a long slow drag, and a sheet that ignored the throw because
        // it had not crossed the midpoint would feel like it was arguing.
        const velocity = drag.velocity
        const target: SheetDetent =
          Math.abs(velocity) > FLICK_PX_PER_MS
            ? velocity < 0
              ? "tall"
              : "split"
            : y.get() < travel / 2
              ? "tall"
              : "split"
        settle(target, velocity)
      }

      // Bound to the header rather than the window: pointer capture routes every
      // move here, so the drag keeps tracking once the finger leaves the strip.
      header.addEventListener("pointermove", handleMove)
      header.addEventListener("pointerup", handleEnd)
      header.addEventListener("pointercancel", handleEnd)
    },
    [detent, measureTravel, settle, suppressNextClick, y],
  )

  return { sheetRef, detent, toggle, onPointerDown, restY: REST_Y }
}
