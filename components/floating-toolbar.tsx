"use client"

import { motion, useReducedMotion, type MotionValue } from "framer-motion"
import type { Capture } from "@/lib/types"
import { useIsMobile } from "@/hooks/use-mobile"
import { Elevated } from "@/lib/elevated"
import { captureFlash, spring } from "@/lib/springs"
import { BAR_GAP, SLOT_RADIUS, SLOT_SIZE } from "@/lib/toolbar-geometry"
import { cn } from "@/lib/utils"
import { CaptureSlot } from "./capture-slot"
import { ShutterButton } from "./shutter-button"
import { ShaderTabs } from "./shader-tabs"
import { ModeTabs, type CaptureMode } from "./mode-tabs"

interface FloatingToolbarProps {
  shaderId: string
  onShaderChange: (shaderId: string) => void
  mode: CaptureMode
  onModeChange: (mode: CaptureMode) => void
  /** Hidden entirely where MediaRecorder is unavailable; see app/page.tsx. */
  videoSupported: boolean
  onCapture: () => void
  isRecording: boolean
  recordingProgress: MotionValue<number>
  captures: Capture[]
  onThumbnailClick: (captureIndex: number) => void
  /** Whether to render the thumbnail slot at all — see app/page.tsx. */
  hasSlot: boolean
  /** Passed straight through to the thumbnail; see CaptureThumbnail. */
  suppressMorph?: boolean
}

/**
 * Desktop's floating control bar: every shader and the shutter, permanently on
 * screen, with captures landing in the slot on its left.
 *
 * Unlike the rest of the chrome that floats over the artwork, this one is *not*
 * pinned to the dark palette — it follows the page theme, so it must stay a
 * sibling of the canvas rather than a child of the `dark`-scoped wrapper in
 * app/page.tsx.
 */
export function FloatingToolbar({
  shaderId,
  onShaderChange,
  mode,
  onModeChange,
  videoSupported,
  onCapture,
  isRecording,
  recordingProgress,
  captures,
  onThumbnailClick,
  hasSlot,
  suppressMorph,
}: FloatingToolbarProps) {
  // This bar is only CSS-hidden on mobile, so without a JS gate its thumbnail
  // would stay mounted alongside the mobile bar's — two elements claiming one
  // layoutId, which makes Framer blank whichever it decides is the stale copy.
  const isMobile = useIsMobile()
  const prefersReducedMotion = useReducedMotion()

  const latest = captures[captures.length - 1]
  const showThumbnail = !isMobile && !!latest

  const handleThumbnailClick = () => {
    const originalIndex = captures.findIndex((c) => c.id === latest.id)
    onThumbnailClick(originalIndex !== -1 ? originalIndex : captures.length - 1)
  }

  return (
    // The bar widens the first time a capture lands, on the same spring the
    // thumbnail arrives on — so the two read as one gesture: the bar making
    // room, and the frame taking it.
    <Elevated
      data-floating-toolbar
      offset={2}
      shadowLevel={3}
      // Centred on the window, sidebar included — not on the canvas. This was
      // briefly `calc((100vw - var(--sidebar-width))/2)`, which put the bar in
      // the middle of the artwork; the window is the frame of reference it is
      // meant to sit in, so a plain `left-1/2` is the whole of it.
      className="hidden md:flex fixed bottom-6 left-1/2 -translate-x-1/2 z-10 items-center gap-2 rounded-full p-1.5"
    >
      {/* The slot, mounted whether or not there is anything in it — an element
          that isn't there can't animate its way in, and this has to collapse
          again when the last capture is deleted. Width rather than display: the
          bar is content-sized and centred, so the bar's own resize falls out of
          this one, pushing both its edges outward as the slot opens. The
          negative margin swallows the flex gap while closed, which would
          otherwise leave 8px of dead space at rest. */}
      <motion.div
        className={cn(
          // Above the tabs and the shutter: on the way out of the gallery the
          // thumbnail is scaled to the full viewport inside this bar, and its
          // later siblings would otherwise paint straight over the top of it.
          "relative z-10 shrink-0",
          // Never clipped while open, and it doesn't need to be: the thumbnail
          // is centred and scales from 0 on this same spring, so it is exactly
          // as wide as the slot at every frame. Letting content escape is a
          // requirement, not an oversight — the thumbnail's layoutId morph
          // scales it to full-screen on the way into the gallery, and a 48px
          // clip would crop that flat. Clipping only while shut, to keep a
          // zero-width slot from leaking anything over the tabs.
          hasSlot ? "overflow-visible" : "overflow-hidden",
          // Opening the gallery mid-recording would leave the shader animating
          // at full cost behind an opaque backdrop, recording something nobody
          // can see.
          //
          // Dimmed as well as inert, which reverses the note that used to stand
          // here: that fading a picture would read as the capture itself being
          // unavailable. True of a thumbnail dimmed on its own, and this one
          // never is — both tracks beside it go to the same 40% on the same
          // frame, and against them a thumbnail left at full strength did not
          // read as an available picture, it read as the one control still live
          // in a locked bar. It is the brightest thing in the row at exactly the
          // moment it does nothing.
          //
          // 70%, where the two tracks beside it are at 40%, and deliberately
          // not the same number. Those are labels and this is a photograph: it
          // has more to lose, and at 40% it stopped reading as a dimmed picture
          // and started reading as a damaged one — the objection above coming
          // true by the other route. 70% is enough to drop it behind the
          // shutter without taking the frame with it.
          "transition-opacity duration-150 ease-out motion-reduce:transition-none",
          isRecording && "pointer-events-none opacity-70",
        )}
        // Animating layout properties rather than a transform, knowingly —
        // see the note above on why the width is the point. One 48px box on a
        // 160ms spring.
        //
        // initial={false} so a reload with captures already in hand paints the
        // slot open instead of animating it open.
        initial={false}
        animate={{ width: hasSlot ? SLOT_SIZE : 0, marginRight: hasSlot ? 0 : -BAR_GAP }}
        // Same spring and same delay as the thumbnail it is making room for, so
        // the two are one gesture — and so the slot's width and the thumbnail's
        // scale are the same number at every frame. Only the opening waits on
        // the flash; closing is a deletion, unrelated to the shutter.
        transition={
          prefersReducedMotion
            ? { duration: 0 }
            : { ...spring.moderate, delay: hasSlot ? captureFlash.holdEndMs / 1000 : 0 }
        }
        style={{ height: SLOT_SIZE }}
      >
        {showThumbnail && (
          <CaptureSlot
            capture={latest}
            previous={captures[captures.length - 2]}
            width={SLOT_SIZE}
            height={SLOT_SIZE}
            radius={SLOT_RADIUS}
            // The bar is already an opaque surface; a drop shadow here would
            // read as a sticker sitting on it.
            elevated={false}
            suppressMorph={suppressMorph}
            // pointer-events-none above stops a pointer and nothing else; this
            // is what takes the keyboard and the click sound with it.
            disabled={isRecording}
            onClick={handleThumbnailClick}
          />
        )}
      </motion.div>

      <ShaderTabs
        shaderId={shaderId}
        onShaderChange={onShaderChange}
        layoutIdPrefix="desktop"
        // Locked mid-clip alongside the mode track beside it. Not for the same
        // reason — a shader swap is a program swap on a live canvas, so the clip
        // survives it — but because a recording is meant to be of one artwork.
        disabled={isRecording}
      />

      {/* Between the shader tabs and the shutter, and the order is the whole
          argument: this track changes what the button beside it *does*, so it
          belongs against the button. The shader tabs change the artwork, so they
          stay against the artwork's end of the bar. Adjacency is what tells you
          which is which — and it no longer carries that alone, now that the two
          hold different kinds of thing: circled numerals there, worded pills
          here. The shapes separate them at a glance; the order still says why. */}
      {videoSupported && (
        <ModeTabs
          mode={mode}
          onModeChange={onModeChange}
          layoutIdPrefix="desktop"
          // Switching to Image mid-clip would freeze the canvas halfway through
          // the recording.
          disabled={isRecording}
        />
      )}

      <ShutterButton
        onPress={onCapture}
        mode={mode}
        isRecording={isRecording}
        progress={recordingProgress}
      />
    </Elevated>
  )
}
