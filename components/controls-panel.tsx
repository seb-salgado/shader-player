"use client"

import { useCallback, useRef } from "react"
import * as DialogPrimitive from "@radix-ui/react-dialog"
import { useReducedMotion } from "framer-motion"
import { X } from "lucide-react"

import type { ShaderParams } from "@/lib/shader-uniforms"
import { getShaderConfig } from "@/lib/shader-configs"
import { playDigitalClick } from "@/lib/audio-feedback"
import { controlsSplit } from "@/lib/springs"
import { useSheetDetent } from "@/hooks/use-sheet-detent"
import { CreditsFooter } from "./credits-footer"
import { ParameterGroup } from "./parameter-group"
import { ShaderTabs } from "./shader-tabs"

interface ControlsPanelProps {
  params: ShaderParams
  setParams: (params: ShaderParams) => void
  open: boolean
  onOpenChange: (open: boolean) => void
  shaderId: string
  onShaderChange: (shaderId: string) => void
  /** Freezes the shader picker mid-clip. The parameters below it stay live. */
  isRecording?: boolean
}

/** The scrim reaches full strength this far into the scroll. */
const SCRIM_RAMP_PX = 24

/** The visible fade, and the number this was specified at. */
const SCRIM_HEIGHT_PX = 56

/**
 * How far the scrim reaches *up*, behind the header, and why it has to.
 *
 * The scroll region and the scrim are two boxes sharing one edge — the header's
 * bottom — and a shared edge is a rounding decision each of them makes on its
 * own. The scroller is composited on its own layer, so its clip and the scrim's
 * paint land on device pixels independently: wherever the edge falls on a
 * fraction, one of them rounds up and a hairline of unveiled content survives
 * between them. It is invisible at DPR 2 with an even viewport, where the edge
 * is a whole device pixel; a phone at DPR 3 with an odd height puts it on a half.
 *
 * Overlapping removes the shared edge rather than trying to align it. The four
 * pixels cost nothing — they sit behind an opaque header — and the gradient's
 * first stop is pushed down by the same amount, so the *visible* fade still
 * starts exactly at the header's edge and is still SCRIM_HEIGHT_PX tall.
 */
const SCRIM_OVERLAP_PX = 4

/**
 * The sheet's fill, and it is a recipe rather than a rung on the surface ladder.
 *
 * The colour the segmented tracks are: `bg-foreground/[0.06]` over
 * `--background`, which is what the mode tabs and the shader tabs paint against
 * the mobile bar. Flattened here, because those are translucent and this one
 * cannot be — an opaque fill is what the header and the scrim are built on, and
 * at the lifted detent there is a live shader directly behind it.
 *
 * Written as the mix rather than as the hex it evaluates to (#181818, a single
 * step off --surface-1) so it stays derived from the same two tokens the track
 * derives from. Name the nearest surface level here instead and the two match
 * today, then drift the first time either end of the ladder is retuned.
 *
 * The contents keep the default level-1 substrate, which is correct now that the
 * panel sits back down at roughly --surface-1: raisedThumb's +4 lands on
 * --surface-5, the level the tab thumb was designed against.
 */
const PANEL_SURFACE = "color-mix(in srgb, var(--foreground) 6%, var(--background))"

/**
 * The top corners, at both detents, and the same 12px the viewfinder above is
 * clipped to.
 *
 * Constant, which is a correction. The radius used to be 0 at the split and open
 * up as the sheet lifted, on the argument that a flush half-screen is not an
 * object and a layer over the canvas is. Sound on paper; wrong in the hand. It
 * put a second thing in motion during a gesture whose whole job is to move one,
 * and the sheet read as unstable rather than as responsive. Matching the
 * canvas's own radius says the more useful thing anyway: two panes of the same
 * instrument, one above the other.
 */
const SHEET_RADIUS = "12px"

/**
 * The mobile controls, in either of the two positions they rest at.
 *
 * **At the split** — where it always opens — this is not a sheet, which is what
 * it used to be and why it used to be called one. A sheet slides over the
 * canvas; this occupies space the canvas gave up, and it is flush and square
 * because it is not lying on the page, it *is* the page's bottom half. See
 * `controlsSplit` for the mechanism, and app/page.tsx for the half that moves.
 *
 * **Lifted** — dragged up to `tallFraction` — it covers the canvas instead, and
 * nothing about it changes but where it is: same fill, same corners, same
 * substrate for everything inside it. See SHEET_RADIUS for the version that did
 * grade its shape across the drag, and why that is gone.
 *
 * The canvas does not move for any of it either. It stepped back once, when the
 * panel opened; a viewfinder that shrank again every time the workbench grew
 * would put two elements on one axis for one gesture. What the drag costs the
 * canvas is cover, not size.
 *
 * Still a Radix dialog, and deliberately: the focus trap, Escape, focus return
 * and dismiss-on-outside-tap all come free, and the last of those is a required
 * behaviour — the canvas above is the natural way back out, and it is "outside"
 * as far as the dialog is concerned. It stays the way out from *both* detents:
 * the drag chooses a position, it never chooses to close.
 */
export function ControlsPanel({
  params,
  setParams,
  open,
  onOpenChange,
  shaderId,
  onShaderChange,
  isRecording = false,
}: ControlsPanelProps) {
  const prefersReducedMotion = useReducedMotion()
  const returnFocusRef = useRef<HTMLElement | null>(null)
  const scrimRef = useRef<HTMLDivElement>(null)
  const { sheetRef, detent, toggle, onPointerDown, restY } = useSheetDetent(open)

  const { enter, exit, ease, panelTravelPx, tallTopPx } = controlsSplit
  const duration = open ? enter.panelMs : exit.panelMs
  const delay = open ? enter.panelDelayMs : 0

  const updateParam = (key: string, value: number | string) => {
    setParams({ ...params, [key]: value })
  }

  /**
   * The scrim's strength, written straight to the element.
   *
   * No state and no re-render: this fires on every scroll frame, and a setState
   * here would re-render every parameter group and every slider in the panel to
   * change one number on one div. The same reasoning RecordingTimer gives for
   * taking a MotionValue instead of a prop.
   *
   * Ramped rather than switched, because at rest there is nothing underneath the
   * header to veil — a scrim that is already at full strength on an unscrolled
   * panel just makes the first group look dimmed.
   */
  const handleScroll = useCallback((event: React.UIEvent<HTMLDivElement>) => {
    const scrim = scrimRef.current
    if (!scrim) return
    scrim.style.opacity = `${Math.min(event.currentTarget.scrollTop / SCRIM_RAMP_PX, 1)}`
  }, [])

  const shaderConfig = getShaderConfig(shaderId)

  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Content
          aria-modal="true"
          aria-describedby={undefined}
          inert={!open}
          onOpenAutoFocus={() => {
            // There is no Radix trigger in this controlled composition, so
            // remember the control that opened us before focus enters the panel.
            returnFocusRef.current = document.activeElement as HTMLElement | null
          }}
          onCloseAutoFocus={(event) => {
            event.preventDefault()
            returnFocusRef.current?.focus()
            returnFocusRef.current = null
          }}
          onEscapeKeyDown={() => playDigitalClick("strong")}
          // Tapping the canvas above is a dismiss, and it gets the same receipt
          // as the X and as Escape.
          onPointerDownOutside={() => playDigitalClick("strong")}
          // `dark` matches the mobile control bar: this panel only ever opens on
          // mobile, so it stays on the dark palette whatever the page theme is.
          //
          // This box is pinned at the *tall* detent and never moves. What moves
          // is the sheet inside it, on a transform — which is what lets the drag
          // be compositor work, and what lets this element go on owning the
          // enter/exit animation below without the two fighting over `transform`.
          //
          // Transparent and pointer-events-none, both load-bearing. Between
          // `tallFraction` and the split there is nothing here but canvas, and a
          // box that caught pointers over it would swallow the outside-tap that
          // is the natural way back out. Radix's own outside test is DOM
          // containment, not geometry, so it still reads a tap on the canvas
          // correctly.
          className="dark pointer-events-none fixed inset-x-0 bottom-0 z-50 text-foreground outline-none data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=open]:fade-in-0 data-[state=closed]:fade-out-0 motion-reduce:animate-none"
          style={{
            // How far the panel can ever reach — not where it rests. The split is
            // controlsSplit.openFraction, applied to the sheet below as a
            // transform down from this edge. The page root is exactly 100dvh tall
            // and the canvas is scaled against that same fraction of it, so the
            // split edge and the canvas's bottom edge are derived from one number
            // and cannot drift — the canvas simply stops
            // controlsSplit.canvasGapPx short of it.
            //
            // From the token rather than a `top-8` class, and no `vh` fallback
            // beside it. Both fall out of this being pixels: there is no viewport
            // unit here to degrade, so the dual-declaration arrangement the page
            // root needs for h-screen/100dvh has nothing to guard against, and
            // the number is free to have exactly one home.
            top: `${tallTopPx}px`,
            // The travel, from the token rather than from a slide-in-from-*
            // utility, so `panelTravelPx` is the only place it is written down.
            // tw-animate-css's enter/exit keyframes read exactly these two.
            "--tw-enter-translate-y": `${panelTravelPx}px`,
            "--tw-exit-translate-y": `${panelTravelPx}px`,
            animationDuration: prefersReducedMotion ? "0ms" : `${duration}ms`,
            animationDelay: prefersReducedMotion ? "0ms" : `${delay}ms`,
            animationTimingFunction: ease,
            // Required, not defensive. tw-animate-css defaults the fill mode to
            // `forwards`, so for the length of animationDelay the panel would
            // sit at its *resting* style — fully opaque, in place — and then
            // snap back to the start of the animation. `both` holds the first
            // keyframe through the delay instead.
            animationFillMode: "both",
          } as React.CSSProperties}
        >
          {/* The sheet. Everything that is painted, and the only thing that moves
              between the two detents.

              --sheet-y is seeded here and then never restated by React.
              useSheetDetent rewrites it on this element every frame, and a
              render that re-declared it would snap the sheet back to its resting
              value mid-flight — so it is a constant in this object, which the
              panel can afford because it always mounts at the split.
              --sheet-slack is the opposite: genuinely state, changing only when
              the detent does, and the scroller below is where it is spent.

              --panel-surface is declared here rather than on each of the three
              elements that paint it, so the header and the scrim inherit one
              value and cannot fall out of step with the sheet behind them. */}
          <div
            ref={sheetRef}
            className="pointer-events-auto flex h-full flex-col will-change-transform"
            style={{
              "--sheet-y": restY.split,
              "--sheet-slack": detent === "tall" ? "0px" : restY.split,
              "--panel-surface": PANEL_SURFACE,
              transform: "translate3d(0, var(--sheet-y), 0)",
              backgroundColor: "var(--panel-surface)",
              borderTopLeftRadius: SHEET_RADIUS,
              borderTopRightRadius: SHEET_RADIUS,
            } as React.CSSProperties}
          >
            {/* Fixed, and that is the whole shape of this panel: the title and
                the way out never move, and everything else runs underneath them.
                It is also the grab surface — all of it, so what has to be reached
                for is a header rather than a four-pixel pill.

                touch-action is not inherited, and a vertical drag here has to be
                ours rather than the browser's. `relative z-10` plus the opaque
                fill is what the scrim's overlap hides behind: the colour is the
                one the sheet already paints, so there is nothing to look at — it
                is here to be opaque, and to sit above a sibling that reaches up
                underneath it. It carries the radius too, or its square corners
                would fill the sheet's rounded ones back in. */}
            <div
              onPointerDown={onPointerDown}
              className="relative z-10 shrink-0 [touch-action:none]"
              style={{
                backgroundColor: "var(--panel-surface)",
                borderTopLeftRadius: SHEET_RADIUS,
                borderTopRightRadius: SHEET_RADIUS,
              }}
            >
              {/* The only thing on screen that says this panel moves — and the
                  way to move it without a gesture, since a tap or an Enter
                  toggles. That is what keeps the second detent reachable from
                  the keyboard, and by anyone who never thinks to try the drag.

                  Deliberately not full width. A w-full button here is the exact
                  shape that put two blue bands across the panel in 077dc76:
                  Radix focuses the first tabbable child on open, WebKit matches
                  :focus-visible on a script focus, and the ring runs off both
                  edges. Sized to its own content, the app's ring lands on the
                  grabber, where it means something. */}
              <div className="flex justify-center">
                <button
                  type="button"
                  onClick={() => {
                    playDigitalClick("soft")
                    toggle()
                  }}
                  aria-expanded={detent === "tall"}
                  aria-label={detent === "tall" ? "Collapse controls" : "Expand controls"}
                  className="group flex items-center justify-center px-8 pb-2 pt-3"
                >
                  <span
                    aria-hidden
                    className="h-1 w-9 rounded-full bg-foreground/25 transition-colors duration-150 group-active:bg-foreground/40"
                  />
                </button>
              </div>

              <DialogPrimitive.Close asChild>
                <button
                  type="button"
                  onClick={() => playDigitalClick("strong")}
                  className="flex w-full items-center justify-between px-4 pb-4 pt-1 transition-transform duration-[125ms] ease-[cubic-bezier(0.23,1,0.32,1)] active:scale-[0.99] motion-reduce:transform-none motion-reduce:transition-none"
                >
                  <DialogPrimitive.Title asChild>
                    <span className="font-mono text-sm">Shader Controls</span>
                  </DialogPrimitive.Title>
                  <X className="h-4 w-4" />
                </button>
              </DialogPrimitive.Close>
            </div>

            <div className="relative min-h-0 flex-1">
              <div
                onScroll={handleScroll}
                // touch-action is not inherited, but html and body carry
                // `touch-action: none` below 768px to kill the page bounce — so a
                // scroller here has to name the axis it wants back. Same move the
                // gallery carousel makes for `pan-x`.
                className="flex h-full min-h-0 flex-col overflow-y-auto overscroll-contain px-4 [touch-action:pan-y]"
                // The slack is what lets one fixed box serve two detents, and it is
                // the whole reason the drag can be a transform.
                //
                // This scroller is always sized for the *tall* detent, because that
                // is the size of the box it lives in and the box never resizes. At
                // the split, the bottom of that box hangs below the screen — so
                // without slack the last parameter group would scroll to the bottom
                // of a viewport nobody can see, and the panel would simply end with
                // rows unreachable. A padding equal to the travel gives the last row
                // somewhere to stop instead: the *visible* bottom edge.
                //
                // It flips when the detent does, at the start of the settle rather
                // than the end. Going up, dropping it shrinks scrollHeight and
                // clamps scrollTop by up to a full travel — which is exactly the
                // distance the sheet is rising, in the same frames, so the two
                // cancel and the row being read does not move.
                style={{
                  paddingBottom: "calc(var(--sheet-slack) + 1rem + env(safe-area-inset-bottom, 0px))",
                }}
              >
                {/* The shader picker scrolls with the parameters now, where it
                    used to be pinned above them on the argument that which shader
                    you are on is the frame for everything below. That argument was
                    written for a sheet that covered the artwork. It no longer
                    holds: the shader is on screen above this panel the entire
                    time, so the track is not what tells you which one you have —
                    and in a panel half a screen tall, a second row of fixed chrome
                    is 48px that the parameters need more.

                    `w-fit` because the track is a recess the cells sit in, not a
                    bar the panel is divided by. Left to stretch it spans the full
                    width — a flex container is block-level — and the run of empty
                    track past the last cell reads as a fourth slot that never
                    fills. */}
                <div className="w-fit shrink-0 pb-4">
                  <ShaderTabs
                    shaderId={shaderId}
                    onShaderChange={onShaderChange}
                    layoutIdPrefix="panel"
                    size="mobile"
                    disabled={isRecording}
                  />
                </div>

                <div className="space-y-6">
                  {shaderConfig.parameterGroups.map((group) => (
                    <ParameterGroup
                      // Keyed by shader too — see the matching note in
                      // ControlsSidebar. A bare group-name key lets React carry a
                      // Collapsible over to a shader that shares the name, and it
                      // replays its open animation against the height it measured
                      // for the previous shader.
                      key={`${shaderId}:${group.name}`}
                      group={group}
                      params={params}
                      onChange={updateParam}
                      shaderId={shaderId}
                    />
                  ))}
                </div>

                {/* No appearance control: this panel and the bar behind it are
                    both pinned `dark`, so the only thing the setting still reaches
                    from here is the wallpaper gallery — not enough to justify a
                    control that can't show its own effect. */}
                <div className="mt-auto pt-6">
                  <CreditsFooter />
                </div>
              </div>

              {/* Where the scrolling half passes under the fixed half. A gradient
                  in the panel's own background rather than a mask on the scroller:
                  a mask would clip the colour picker's popover, which opens out of
                  this box, and parameter-group already documents what a stray clip
                  does to a slider's tooltip. */}
              <div
                ref={scrimRef}
                aria-hidden
                className="pointer-events-none absolute inset-x-0"
                style={{
                  top: -SCRIM_OVERLAP_PX,
                  height: SCRIM_HEIGHT_PX + SCRIM_OVERLAP_PX,
                  opacity: 0,
                  // Solid until the overlap is spent, so the fade itself begins on
                  // the header's edge and runs the full SCRIM_HEIGHT_PX below it.
                  // The last stop is implicit at 100%, which is that exact point.
                  // Reads --panel-surface, for the reason PANEL_SURFACE gives: the
                  // sheet's fill is a mix of two tokens rather than a rung on the
                  // ladder, and a scrim that named the nearest rung instead would
                  // show as a band under the header.
                  backgroundImage: `linear-gradient(to bottom, var(--panel-surface) ${SCRIM_OVERLAP_PX}px, transparent)`,
                }}
              />
            </div>
          </div>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  )
}
