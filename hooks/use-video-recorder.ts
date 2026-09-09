"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { useMotionValue, type MotionValue } from "framer-motion"
import {
  MAX_RECORDING_MS,
  RECORD_FPS,
  pickVideoFormat,
  videoBitsPerSecond,
} from "@/lib/video-capture"

export type RecorderState = "idle" | "recording" | "finalizing"

export interface RecordingResult {
  /** Object URL for the recording. Ownership passes to the caller. */
  url: string
  mimeType: string
  durationMs: number
  /** The canvas's drawing-buffer size at the moment recording started. */
  width: number
  height: number
}

interface UseVideoRecorderOptions {
  onComplete: (result: RecordingResult) => void
}

/**
 * The canvas, recorded.
 *
 * Everything with a lifetime lives here; what the browser can encode and at what
 * rate is lib/video-capture.ts.
 *
 * **Progress and elapsed time are MotionValues, never state.** A setState per
 * frame would re-render the page and both control bars thirty times a second,
 * which is the exact cost plans 002, 006 and 007 exist to keep out of this app.
 * The shutter ring and the timer subscribe to these directly and React never
 * hears about it.
 */
export function useVideoRecorder({ onComplete }: UseVideoRecorderOptions) {
  const [state, setState] = useState<RecorderState>("idle")

  const progress = useMotionValue(0)
  const elapsedMs = useMotionValue(0)

  const recorderRef = useRef<MediaRecorder | null>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const chunksRef = useRef<Blob[]>([])
  const startedAtRef = useRef(0)
  const frameRef = useRef<number | null>(null)
  const capTimerRef = useRef<number | null>(null)
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const dimensionsRef = useRef({ width: 0, height: 0 })

  const onCompleteRef = useRef(onComplete)
  onCompleteRef.current = onComplete

  const clearTimers = useCallback(() => {
    if (frameRef.current !== null) cancelAnimationFrame(frameRef.current)
    if (capTimerRef.current !== null) window.clearTimeout(capTimerRef.current)
    frameRef.current = null
    capTimerRef.current = null
  }, [])

  /**
   * Idempotent, and it has to be: the cap, the visibility handler, the resize
   * watchdog and the user's own second tap can all arrive at once, and there is
   * a frame between `stop()` and `onstop` in which the recorder is still live.
   */
  const stop = useCallback(() => {
    const recorder = recorderRef.current
    if (!recorder || recorder.state === "inactive") return
    clearTimers()
    setState("finalizing")
    recorder.stop()
  }, [clearTimers])

  const start = useCallback(
    (canvas: HTMLCanvasElement) => {
      if (recorderRef.current) return
      const format = pickVideoFormat()
      if (!format) return

      let stream: MediaStream
      let recorder: MediaRecorder
      try {
        stream = canvas.captureStream(RECORD_FPS)
        recorder = new MediaRecorder(stream, {
          mimeType: format.mimeType,
          videoBitsPerSecond: videoBitsPerSecond(canvas.width, canvas.height),
        })
      } catch {
        // A browser that passed the feature probe can still refuse the actual
        // stream. Nothing to show for it, and nothing broken — the shutter just
        // did not start recording.
        return
      }

      canvasRef.current = canvas
      dimensionsRef.current = { width: canvas.width, height: canvas.height }
      chunksRef.current = []
      recorderRef.current = recorder
      streamRef.current = stream
      progress.set(0)
      elapsedMs.set(0)

      recorder.ondataavailable = (event) => {
        // Guarded rather than assumed: no timeslice is requested, so this should
        // fire once at the end, but some builds emit more than one blob anyway.
        if (event.data.size > 0) chunksRef.current.push(event.data)
      }

      recorder.onstop = () => {
        clearTimers()
        const chunks = chunksRef.current
        const durationMs = startedAtRef.current
          ? Math.round(performance.now() - startedAtRef.current)
          : 0

        // Not optional: a canvas capture track left live keeps pulling frames
        // off the canvas for the rest of the session.
        streamRef.current?.getTracks().forEach((track) => track.stop())
        streamRef.current = null
        recorderRef.current = null
        chunksRef.current = []
        canvasRef.current = null
        startedAtRef.current = 0

        // Deliberately *not* reset here — they are reset in start() instead.
        // Zeroing them on stop rewrites the timecode to 0:00 while the readout
        // is still playing its exit, so the last thing you see of a fifteen
        // second recording is it claiming to be zero seconds long.
        setState("idle")

        if (!chunks.length) return
        const blob = new Blob(chunks, { type: format.mimeType })
        onCompleteRef.current({
          url: URL.createObjectURL(blob),
          mimeType: format.mimeType,
          durationMs,
          width: dimensionsRef.current.width,
          height: dimensionsRef.current.height,
        })
      }

      /**
       * The *clock* starts here rather than on the click.
       *
       * MediaRecorder.start() returns before the first frame has been encoded,
       * so timing from the press makes durationMs overstate the clip and starts
       * the ring filling against footage that does not exist yet.
       *
       * The *state* deliberately does not wait for this — see below. This
       * callback lands 55–65ms after the press in practice, which is nothing for
       * a duration and an eternity for a button.
       */
      recorder.onstart = () => {
        startedAtRef.current = performance.now()

        const tick = () => {
          const elapsed = performance.now() - startedAtRef.current
          elapsedMs.set(elapsed)
          progress.set(Math.min(elapsed / MAX_RECORDING_MS, 1))

          // The drawing buffer changed size mid-stream — a rotation, or a
          // sidebar drag. VP8/VP9 tolerate it; mp4/avc1 does not, and produces a
          // file QuickTime refuses to open. Ending the clip here keeps whatever
          // was recorded up to the resize, which is the honest outcome.
          const canvas = canvasRef.current
          if (
            canvas &&
            (canvas.width !== dimensionsRef.current.width ||
              canvas.height !== dimensionsRef.current.height)
          ) {
            stop()
            return
          }

          if (elapsed >= MAX_RECORDING_MS) {
            stop()
            return
          }
          frameRef.current = requestAnimationFrame(tick)
        }
        frameRef.current = requestAnimationFrame(tick)

        // The cap, again, on a timer. rAF is suspended in a background tab, so
        // the loop above would never reach the cap there — while captureStream
        // keeps emitting duplicate frames of a canvas that has stopped changing.
        capTimerRef.current = window.setTimeout(stop, MAX_RECORDING_MS)
      }

      try {
        // No timeslice: one blob at the end. There is nothing worth salvaging
        // from a partial clip of fifteen seconds or less.
        recorder.start()
        /**
         * The shutter acknowledges the press here, not in `onstart`.
         *
         * Waiting for the encoder put 55–65ms between letting go of the button
         * and anything happening to it — which the shutter spent releasing its
         * press affordance, so the fill sprang back to full size and only then
         * collapsed into the stop glyph. The press looked like it had bounced
         * off.
         *
         * Nothing is being claimed early: `recorder.start()` has returned, the
         * recorder's own state is already "recording", and the throw below is
         * the only way it does not record — in which case state was never set.
         * What is deferred is the clock, which is the only thing that actually
         * needed the encoder.
         */
        setState("recording")
      } catch {
        recorderRef.current = null
        streamRef.current = null
        stream.getTracks().forEach((track) => track.stop())
      }
    },
    [clearTimers, elapsedMs, progress, stop],
  )

  /**
   * Backgrounding ends the recording rather than pausing it.
   *
   * rAF stops in a hidden tab but captureStream does not: the encoder keeps
   * taking frames of a canvas that is no longer being drawn, so you come back to
   * a clip with the right wall-clock length and a frozen stretch through the
   * middle. A shorter, honest clip is the better artefact.
   */
  useEffect(() => {
    const end = () => {
      if (document.visibilityState === "hidden") stop()
    }
    document.addEventListener("visibilitychange", end)
    window.addEventListener("pagehide", stop)
    return () => {
      document.removeEventListener("visibilitychange", end)
      window.removeEventListener("pagehide", stop)
    }
  }, [stop])

  useEffect(() => {
    return () => {
      clearTimers()
      const recorder = recorderRef.current
      if (recorder && recorder.state !== "inactive") recorder.stop()
      streamRef.current?.getTracks().forEach((track) => track.stop())
    }
  }, [clearTimers])

  return {
    state,
    isRecording: state === "recording",
    /** 0 → 1 across MAX_RECORDING_MS. */
    progress: progress as MotionValue<number>,
    elapsedMs: elapsedMs as MotionValue<number>,
    start,
    stop,
  }
}
