"use client"

import { useCallback, useRef } from "react"
import { Pause, Play } from "lucide-react"
import { formatDuration } from "@/lib/video-capture"
import type { RecordingPlayback } from "@/hooks/use-recording-playback"
import { cn } from "@/lib/utils"

/** The portfolio player's curve, carried across with the rest of its design. */
const FADE = "opacity 150ms cubic-bezier(0.23, 1, 0.32, 1)"

/** One arrow key. A second is a sensible step over a clip capped at fifteen. */
const KEY_STEP_SECONDS = 1

interface GalleryVideoControlsProps {
  playback: RecordingPlayback
  /**
   * The two places this bar is ever put, and they differ in more than position.
   *
   * `over-capture` is the pointer gallery's: pinned to the foot of the picture,
   * with the portfolio's own 16px of room under the buttons.
   *
   * `above-strip` is the touch gallery's: in flow at the top of the column that
   * ends in the filmstrip, so it needs no offset to clear it. Its bottom padding
   * comes in to 8px because the strip below brings 14px of its own, and 30px of
   * daylight between a transport and a filmstrip reads as a gap rather than as
   * two rows of one control bar.
   */
  placement: "over-capture" | "above-strip"
  className?: string
}

/**
 * The transport for a recording: a scrubber, a play/pause, and how far through
 * you are.
 *
 * Ported from the video player in the user's portfolio, down to the sizes and
 * the curves — a scrim at the foot of the frame, a 2px track that thickens to
 * 3px under the cursor, a thumb that is only there while you are pointing at it.
 * Its close, mute and fullscreen buttons did not come with it: the gallery has
 * its own close, and a canvas recording has no audio track to mute (see
 * lib/video-capture.ts, where the stream is the canvas and nothing else).
 *
 * White on a scrim in both themes, which is the one place this app does not
 * answer to the appearance toggle. The bar sits over the artwork, and the
 * artwork can be any brightness — the same argument CaptureBadge makes for its
 * own scrim.
 *
 * **It does not contain the `<video>`.** That lives inside the gallery's morph
 * card; this lives in the chrome layer with the close and delete buttons, and
 * the two are joined by useRecordingPlayback. See that hook for why.
 */
export function GalleryVideoControls({
  playback,
  placement,
  className,
}: GalleryVideoControlsProps) {
  const {
    attachProgress,
    playing,
    toggle,
    seek,
    currentSeconds,
    durationSeconds,
    controlsVisible,
  } = playback

  const trackRef = useRef<HTMLDivElement | null>(null)
  const draggingRef = useRef(false)

  // The drawn bar is both what the hook writes `--played` to and what a pointer
  // position has to be measured against, so it takes two refs.
  const setTrackNode = useCallback(
    (node: HTMLDivElement | null) => {
      trackRef.current = node
      attachProgress(node)
    },
    [attachProgress],
  )

  const seekToPointer = useCallback(
    (clientX: number) => {
      const track = trackRef.current
      if (!track) return
      const rect = track.getBoundingClientRect()
      if (rect.width <= 0) return
      seek((clientX - rect.left) / rect.width)
    },
    [seek],
  )

  /**
   * Pointer capture from the first press, and the touch gallery is why it is not
   * optional.
   *
   * `.gallery-carousel` carries `touch-action: pan-x` so a finger can page
   * between captures, and a horizontal drag starting on this track is exactly
   * the gesture it is listening for. `touch-action: none` below refuses it the
   * gesture, and the capture keeps the drag coming here after it has left the
   * 16px the track occupies — which on a bar this thin is most drags.
   */
  const handlePointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if (event.pointerType === "mouse" && event.button !== 0) return
    event.preventDefault()
    draggingRef.current = true
    event.currentTarget.setPointerCapture(event.pointerId)
    seekToPointer(event.clientX)
  }

  const handlePointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!draggingRef.current) return
    seekToPointer(event.clientX)
  }

  const endDrag = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!draggingRef.current) return
    draggingRef.current = false
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId)
    }
  }

  const handleKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (durationSeconds <= 0) return
    const step = KEY_STEP_SECONDS / durationSeconds
    const now = currentSeconds / durationSeconds

    if (event.key === "ArrowLeft" || event.key === "ArrowDown") seek(now - step)
    else if (event.key === "ArrowRight" || event.key === "ArrowUp") seek(now + step)
    else if (event.key === "Home") seek(0)
    else if (event.key === "End") seek(1)
    else return

    event.preventDefault()
    // The desktop gallery steps captures on the arrow-adjacent inputs it owns;
    // a scrubber under the keyboard has the stronger claim on these.
    event.stopPropagation()
  }

  return (
    <div
      className={cn(
        placement === "over-capture" ? "absolute inset-x-0 bottom-0" : "relative",
        className,
      )}
      style={{
        opacity: controlsVisible ? 1 : 0,
        pointerEvents: controlsVisible ? "auto" : "none",
        transition: FADE,
      }}
    >
      <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-black/60 to-transparent" />

      <div
        className={cn(
          "relative flex flex-col gap-2 px-4 pt-8",
          placement === "over-capture" ? "pb-4" : "pb-2",
        )}
      >
        <div
          role="slider"
          tabIndex={0}
          aria-label="Seek"
          aria-valuemin={0}
          aria-valuemax={Math.max(0, Math.floor(durationSeconds))}
          aria-valuenow={currentSeconds}
          aria-valuetext={formatDuration(currentSeconds * 1000)}
          className="group relative flex h-4 w-full cursor-pointer touch-none items-center outline-none"
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={endDrag}
          onPointerCancel={endDrag}
          onKeyDown={handleKeyDown}
        >
          {/* The element that carries `--played`; the fill and the thumb below
              both read it, so one write per frame moves the whole scrubber. */}
          <div
            ref={setTrackNode}
            className="relative h-[2px] w-full rounded-full bg-white/20 transition-[height] duration-150 group-hover:h-[3px] group-focusKey:h-[3px] motion-reduce:transition-none"
          >
            {/* Scaled rather than widened. The radius on a 2px bar is 1px, so
                the ellipse a non-uniform scale makes of it is a pixel wide and
                nothing is visibly distorted — which is what makes the cheap
                version also the correct-looking one here. */}
            <div
              className="absolute inset-0 origin-left rounded-full bg-white/90"
              style={{ transform: "scaleX(var(--played, 0))" }}
            />
            {/* And the thumb rides a full-width layer translated by a percentage
                of its own width, so it too is a transform and needs nobody to
                measure the track for it. */}
            <div
              className="pointer-events-none absolute inset-0"
              style={{ transform: "translateX(calc(var(--played, 0) * 100%))" }}
            >
              <div className="absolute left-0 top-1/2 size-[10px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-white opacity-0 shadow-sm transition-opacity duration-150 group-hover:opacity-100 group-focusKey:opacity-100 motion-reduce:transition-none" />
            </div>
          </div>
        </div>

        <div className="flex items-center gap-4">
          <button
            type="button"
            onClick={toggle}
            aria-label={playing ? "Pause recording" : "Play recording"}
            className="flex cursor-pointer items-center justify-center text-white/80 outline-none transition-colors duration-100 hover:text-white focusKey:text-white motion-reduce:transition-none"
          >
            {playing ? (
              <Pause size={16} strokeWidth={1.75} className="fill-current" />
            ) : (
              // Nudged right by an eighth of its width: a triangle's optical
              // centre is not its bounding box's. Same hand as GalleryVideo's
              // blocked-autoplay button.
              <Play size={16} strokeWidth={1.75} className="translate-x-[1px] fill-current" />
            )}
          </button>

          <div className="flex select-none items-center text-[14px] tracking-wide text-white/60 tabular-nums">
            <span>{formatDuration(currentSeconds * 1000)}</span>
            <span className="mx-0.5 opacity-60">/</span>
            <span>{formatDuration(durationSeconds * 1000)}</span>
          </div>
        </div>
      </div>
    </div>
  )
}
