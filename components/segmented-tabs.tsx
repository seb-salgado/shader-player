"use client"

import { motion, useReducedMotion } from "framer-motion"
import { playDigitalClick } from "@/lib/audio-feedback"
import { useSurface } from "@/lib/surface-context"
import { raisedThumb } from "@/lib/surface-classes"
import { spring } from "@/lib/springs"
import { cn } from "@/lib/utils"

export interface SegmentedOption {
  id: string
  label: string
}

interface SegmentedTabsProps {
  options: SegmentedOption[]
  value: string
  onChange: (id: string) => void
  /** Names the group for assistive tech: "Shader", "Capture mode". */
  ariaLabel: string
  /**
   * Both control bars are mounted at all times — they are only CSS-hidden — and
   * the sheet carries a third copy of the shader picker. A single shared layoutId
   * across those would leave several indicators fighting over one animation, so
   * every instance gets its own prefix and each morph stays inside its own bar.
   */
  layoutIdPrefix: string
  /** Distinguishes the tracks *within* one bar: "shader-tab" against "mode-tab". */
  layoutIdSuffix: string
  size?: "desktop" | "mobile"
  /**
   * What the cells hold decides this, so the caller does: a numeral wants a
   * circle and a word wants a pill. Both are mounted side by side in the desktop
   * bar — 01/02/03 against Image/Video — so it cannot be one choice for the
   * component. See SIZES.
   *
   * `block` is the exception that proves the rule: there the cell is not sized
   * by its contents at all but is a division of the track, which stretches to
   * whatever column it is dropped into. It is the shape for a track that has to
   * be one of the column's rows rather than an object sitting in it — the mobile
   * sheet, where every other control is a full-width slider.
   */
  shape?: "pill" | "circle" | "block"
  /**
   * Inert and dimmed. Used while a recording is running, where changing the
   * capture mode mid-clip would freeze the canvas halfway through it.
   */
  disabled?: boolean
  /**
   * Whether `disabled` also dims the track.
   *
   * True everywhere the track is the only thing saying it is disabled. False in
   * the mobile bar, where the whole control fades out for the length of a clip
   * and the dim would animate underneath the fade — two opacity curves on one
   * element, leaving the track visibly ahead of the thumbnail beside it. The
   * inertness is the half worth keeping; the statement is already being made.
   */
  dimWhenDisabled?: boolean
}

/**
 * Not one set of numbers for both bars: each track has to sit with whatever its
 * own bar puts beside it, and the two bars put different things there.
 *
 * The desktop track is 44 tall with 4px of inset, which puts its cells at 36. 44
 * is the desktop bar's one unit — the thumbnail slot and the shutter either side
 * of this are the same number (SLOT_SIZE in lib/toolbar-geometry.ts, and
 * SHUTTER_SIZES in shutter-button.tsx). That keeps the track's ends on the same
 * line as both, while the selected cell stays a step inside them — the tabs are
 * where you are, not the thing you came here to press. The three move together or
 * not at all: the bar is content-sized, so leaving one of them taller makes it
 * the bar's height and the other two float in the middle of it.
 *
 * Mobile keeps its cells at 40. It shares nothing with the desktop bar but this
 * component — that bar is sized for thumbs, and its own row has no slot or
 * shutter beside the track to line up with.
 *
 * The height is the fixed number in all three shapes; only the width differs.
 * For two of them what the cell holds is what decides it: a `pill` is `px-3` and
 * comes out as wide as the word inside it, and a `circle` is `size-*`, the same
 * number as the height, which is what a numeral wants — it has no length to
 * express. Neither needs a radius of its own: the cell carries `rounded-full`,
 * so a square box *is* the circle.
 *
 * `block` inverts that. The cell is `flex-1` — a third of whatever the track is
 * — and the track is the thing being sized, by the column it sits in. Width is
 * the *only* thing it changes: it rounds `rounded-full` like the other two, so a
 * stretched cell comes out as a wide pill rather than as a box.
 *
 * It stated its own radius once — a 12px track over 8px cells, echoing the
 * sheet's corner, on the argument that a stretched cell is no longer its own
 * height and reads as a lozenge. Rejected in use: the sheet is a column of
 * pills and chips, and the one boxed control in it was the thing that looked
 * placed there rather than built in. Note what the pill costs nothing to keep —
 * `rounded-full` resolves to half of each box's height, and the cell is shorter
 * than the track by exactly the `p-1` inset on both sides, so `inner = outer -
 * inset` falls out of the geometry rather than having to be stated and kept in
 * step. Two constants and two branches went away with it.
 *
 * Both are on screen at once in the desktop bar, which is why this is the
 * caller's choice and not the component's: the shader track holds 01/02/03 and
 * the mode track beside it holds Image/Video.
 *
 * 13px in both, which is what the sliders and the sidebar are set at. The
 * numerals were a step above that when they were the only track in the app and
 * had nothing to be compared against; they have a track of words beside them
 * now, and one of the two being a pixel larger is a mismatch you can see.
 * Everything in the app is Space Mono 400 — size, case and tracking are the only
 * things that ever vary.
 *
 * They differ only between the cells: desktop butts them, mobile spaces them for
 * the touch targets.
 *
 * `cellHeight` is the pixel value of the cell class, and half of it is the
 * indicator's radius. Written out rather than left to `rounded-full` because of
 * the pill instances: there the indicator morphs *width* as well as position,
 * the cells not all being the same size, and Framer's layout projection
 * interpolates whatever number it is given — so a 9999px sentinel rides the
 * whole morph as an ellipse while the real radius stays a pill at both ends.
 * The circle and block instances only ever travel — their cells are all one
 * width — so the value is merely correct for them rather than load-bearing.
 * Same lesson as SLOT_RADIUS in lib/toolbar-geometry.ts. Keep it in step with
 * the classes beside it.
 */
const SIZES = {
  desktop: { track: "gap-0 p-1", pill: "h-9 px-3", circle: "size-9", block: "h-9 flex-1", text: "text-[13px]", cellHeight: 36 },
  mobile: { track: "gap-1 p-1", pill: "h-10 px-3", circle: "size-10", block: "h-10 flex-1", text: "text-[13px]", cellHeight: 40 },
} as const

/**
 * A row of choices with the selected one raised out of the track.
 *
 * The shape of every top-level choice in this app: which shader is playing, and
 * what the shutter produces. Extracted from ShaderTabs when the second one
 * arrived, so the two cannot drift — the track is a recess pressed into whatever
 * surface it lands on, and the selected cell climbs back out of it. Reading the
 * substrate rather than hardcoding a level is what lets the same component sit
 * in the light floating toolbar, in the pinned-dark mobile bar and in the sheet
 * and read raised in all three. The recipe itself lives in
 * lib/surface-classes.ts, shared with the appearance toggle.
 */
export function SegmentedTabs({
  options,
  value,
  onChange,
  ariaLabel,
  layoutIdPrefix,
  layoutIdSuffix,
  size = "desktop",
  shape = "pill",
  disabled = false,
  dimWhenDisabled = true,
}: SegmentedTabsProps) {
  const prefersReducedMotion = useReducedMotion()
  const substrate = useSurface()
  const raised = raisedThumb(substrate)
  const isBlock = shape === "block"

  const handleSelect = (id: string) => {
    if (disabled || id === value) return
    void playDigitalClick("medium")
    onChange(id)
  }

  return (
    <div
      role="radiogroup"
      aria-label={ariaLabel}
      // Dimmed and inert together. The same idiom the mobile bar already uses
      // for the controls it hides behind the sheet, rather than a new disabled
      // variant that would have to invent its own colour.
      className={cn(
        "flex items-center rounded-full bg-foreground/[0.06] transition-opacity duration-150 ease-out motion-reduce:transition-none",
        // A block track is a row of the column it was dropped into, so it takes
        // that column's width. Every other shape is an object sized by its own
        // cells. The pill is common to all three — see SIZES.
        isBlock && "w-full",
        SIZES[size].track,
        disabled && "pointer-events-none",
        disabled && dimWhenDisabled && "opacity-40",
      )}
    >
      {options.map((option) => {
        const isSelected = option.id === value

        return (
          <button
            key={option.id}
            type="button"
            role="radio"
            aria-checked={isSelected}
            aria-label={option.label}
            disabled={disabled}
            onClick={() => handleSelect(option.id)}
            className={cn(
              "relative flex items-center justify-center rounded-full transition-[color,transform] duration-150 ease-out active:scale-[0.97] motion-reduce:transition-none",
              SIZES[size][shape],
              SIZES[size].text,
              isSelected ? "text-foreground" : "text-muted-foreground hoverFine:text-foreground",
            )}
          >
            {isSelected && (
              <motion.span
                layoutId={
                  prefersReducedMotion ? undefined : `${layoutIdPrefix}-${layoutIdSuffix}`
                }
                transition={spring.moderate}
                aria-hidden
                className={cn("absolute inset-0", raised)}
                style={{ borderRadius: SIZES[size].cellHeight / 2 }}
              />
            )}
            {/* Above the indicator, which is painted into the same box. */}
            <span className="relative whitespace-nowrap">{option.label}</span>
          </button>
        )
      })}
    </div>
  )
}
