"use client"

import { useEffect, useState } from "react"
import { galleryEffects } from "@/lib/springs"

interface Dismissal {
  key: number
  src: string
  rect: { left: number; top: number; width: number; height: number }
  /** Whether this exit has to supply its own backdrop; see dismissBackdropMs. */
  covering: boolean
}

let publish: ((dismissal: Dismissal) => void) | null = null
let nextKey = 0

/**
 * The capture you just deleted, leaving.
 *
 * A plain <img> that recedes to 0.8 and fades — a standard exit, not an effect.
 * It replaces a 1.5s WebGL burn and then a 280ms particle dispersal, both of
 * which were ceremony on what is a janitorial action, and neither of which
 * suited the material: a dispersal needs edges to read as fragments, and a soft
 * gradient has none, so it came apart into static rather than pieces.
 *
 * Only ever half of a delete. The other half — the neighbour taking the slot —
 * is drawn by the gallery itself, which is the only place that knows what shape
 * its own list is: the touch strip slides it across a screen, the desktop viewer
 * steps it a dozen pixels down its rail. Both come from the side the earlier
 * capture actually lives on. This one is pinned to the rect the deleted capture
 * occupied and does not travel with it either way, which is what keeps the
 * picture leaving and the picture arriving legible as two events rather than as
 * one thing sliding. It used to be the other way round on desktop, where the
 * replacement came forward out of z and the two halves were deliberately one
 * gesture; that reading went with a rail that put the newest capture on top.
 *
 * The deletion itself commits on the press, before either of them starts.
 *
 * Rendered at the app root rather than inside the gallery, which is the only
 * reason it needs a module-level channel at all: deleting the *last* capture
 * closes the gallery on the press frame, and an exit mounted inside that
 * subtree would be torn down before it drew.
 */
export function CaptureDismissal() {
  const [dismissal, setDismissal] = useState<Dismissal | null>(null)
  const [leaving, setLeaving] = useState(false)

  useEffect(() => {
    publish = (next) => {
      setDismissal(next)
      setLeaving(false)
    }
    return () => {
      publish = null
    }
  }, [])

  // Two commits on purpose. The first paints the ghost at rest, exactly over the
  // capture that was there a frame ago; the second starts the transition. Set
  // together, there is no "from" state to transition out of and it just blinks.
  useEffect(() => {
    if (!dismissal) return
    const start = requestAnimationFrame(() => setLeaving(true))
    const lifetime =
      galleryEffects.dismissMs + (dismissal.covering ? galleryEffects.dismissBackdropMs : 0) + 60
    const clear = window.setTimeout(() => setDismissal(null), lifetime)
    return () => {
      cancelAnimationFrame(start)
      window.clearTimeout(clear)
    }
  }, [dismissal])

  if (!dismissal) return null

  return (
    <div className="fixed inset-0 z-[60] pointer-events-none" aria-hidden="true">
      {/* Stands in for the gallery's own backdrop, which has already gone — see
          dismissBackdropMs. Only for the last capture: any other deletion has
          the next one sitting behind this, and covering it would hide the one
          thing that actually says the delete worked. */}
      {dismissal.covering && (
        <div
          className="absolute inset-0 bg-background"
          style={{
            opacity: leaving ? 0 : 1,
            transition: `opacity ${galleryEffects.dismissBackdropMs}ms ease-out ${galleryEffects.dismissMs}ms`,
          }}
        />
      )}
      <img
        key={dismissal.key}
        src={dismissal.src}
        alt=""
        className="absolute"
        style={{
          left: dismissal.rect.left,
          top: dismissal.rect.top,
          width: dismissal.rect.width,
          height: dismissal.rect.height,
          opacity: leaving ? 0 : 1,
          transform: leaving ? `scale(${galleryEffects.dismissScale})` : "scale(1)",
          // Scaled from its own centre, which is the one thing here that is not
          // worth a token: this is a picture receding, not a popover growing out
          // of the control that opened it. There is no trigger to point at.
          transformOrigin: "center",
          // The two properties are given the same curve but not the same clock —
          // see dismissFadeDelayMs. The shrink starts on the press frame; the
          // fade waits four frames so the capture is visibly the thing that
          // moved before it is allowed to start disappearing.
          transition:
            `transform ${galleryEffects.dismissMs}ms ${galleryEffects.dismissEase}, ` +
            `opacity ${galleryEffects.dismissMs - galleryEffects.dismissFadeDelayMs}ms ` +
            `${galleryEffects.dismissEase} ${galleryEffects.dismissFadeDelayMs}ms`,
        }}
      />
    </div>
  )
}

/**
 * Play the exit for a capture that has just been removed.
 *
 * `wasLast` says whether the gallery went with it, which is the only thing this
 * needs to know about its caller: emptying the list tears the viewer down on the
 * same commit, so for that one case the exit has to bring its own backdrop or
 * the capture dissolves against the live shader.
 *
 * A no-op before the surface has mounted, or under reduced motion — both mean
 * the capture simply goes, which is a correct outcome rather than a degraded
 * one. Nothing waits on this and nothing reports back.
 */
export function dismissCapture(src: string, rect: DOMRect | undefined, wasLast: boolean): void {
  if (!publish || !src || !rect || rect.width < 1) return
  publish({
    key: nextKey++,
    src,
    rect: { left: rect.left, top: rect.top, width: rect.width, height: rect.height },
    covering: wasLast,
  })
}
