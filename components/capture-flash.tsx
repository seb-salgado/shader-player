"use client"

import { motion, useReducedMotion } from "framer-motion"
import { captureFlash } from "@/lib/springs"

/**
 * The shutter blink, over the viewfinder alone.
 *
 * Mounted by key for the duration of one capture: remounting is what restarts
 * the animation, so rapid presses each get their own flash rather than the
 * first one swallowing the rest.
 *
 * Lives inside the canvas's rounded, clipping wrapper, so it picks up the
 * artwork's exact corners without restating them.
 */
export function CaptureFlash() {
  const prefersReducedMotion = useReducedMotion()

  // A luminance jump is exactly what reduced motion asks us to drop, and the
  // shutter still has its click while the thumbnail still appears.
  if (prefersReducedMotion) return null

  return (
    <motion.div
      aria-hidden
      className="absolute inset-0 z-10 pointer-events-none"
      style={{ backgroundColor: captureFlash.color }}
      initial={{ opacity: 0 }}
      animate={{ opacity: [0, 1, 1, 0] }}
      transition={{
        duration: captureFlash.durationMs / 1000,
        times: [
          0,
          captureFlash.riseMs / captureFlash.durationMs,
          captureFlash.holdEndMs / captureFlash.durationMs,
          1,
        ],
        // Linear up — a light source has no attack ramp worth seeing. Flat
        // across the hold. easeInQuad down, so the brightness stays where the
        // eye can find it and then lets go, rather than falling off a cliff the
        // instant it arrives.
        ease: ["linear", "linear", [0.55, 0.085, 0.68, 0.53]],
      }}
    />
  )
}
