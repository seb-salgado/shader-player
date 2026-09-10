"use client"

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react"
import {
  animate,
  motion,
  useMotionValue,
  useMotionValueEvent,
  useReducedMotion,
  type AnimationPlaybackControls,
  type MotionValue,
  type Transition,
} from "framer-motion"
import { type Capture, stillUrl } from "@/lib/types"
import { CaptureBadge } from "@/components/capture-badge"
import { galleryEffects } from "@/lib/springs"
import { cn } from "@/lib/utils"

interface GalleryThumbnailStripProps {
  captures: Capture[]
  currentIndex: number
  onSelect: (index: number) => void
  orientation: "horizontal" | "vertical"
}

/**
 * Peak magnification.
 *
 * Not a taste number, a fit. The rail is 128px wide and the frame's right edge
 * sits 16px inside it, so an 80px thumbnail growing leftward out of
 * `origin-right` has 112px before it reaches the rail's own left edge — and the
 * rail scrolls vertically, which forces the cross axis to clip rather than
 * overflow. 80 × 1.34 = 107.2, which still leaves room for the 2px focus ring
 * to land inside. The 1.48 this used to be put the left edge at −6px: the
 * biggest frame was always sliced off, so 1.48 was never the size on screen.
 */
const DESKTOP_MAX_SCALE = 1.34

/** How far the field reaches on either side of the cursor, in thumbnail pitches. */
const DESKTOP_SPREAD = 2.5

const DESKTOP_FALLBACK_HEIGHT = 56
// Mirrors the rail's `gap-0`: the frames abut, and the daylight between the
// pictures comes from each button's own border and padding rather than from
// flex. Pitch is measured off the live nodes, so this only stands in before
// that measurement lands and for a rail of one — but it has to track the class,
// or the field's reach is wrong on first paint.
const FRAME_FALLBACK_GAP = 0
/** The strip's own fallback, mirroring MOBILE_FRAME_CLASS's width for the same reason. */
const MOBILE_FALLBACK_WIDTH = 41

/**
 * The mobile frame: 41×52, which is a 33×44 picture at 3:4.
 *
 * Upright, uniform, and cropped — each of those a separate decision.
 *
 * *Upright*, because the 92-wide landscape box this replaced showed 40% of a
 * phone-shaped capture. `object-cover` scales to fill the width, so a portrait
 * wallpaper in a 1.44 box loses its top and bottom — most of what makes it
 * recognisable as that capture — at the one size where there is least to go on.
 * At 3:4 the frame keeps 77%.
 *
 * *Uniform*, and not the capture's own aspect, which is what this was for about
 * an hour. Every capture here is the canvas, and the canvas is the screen, so
 * sizing each frame to its source produces no variety at all: just a rank of
 * identical 40px slivers, a barcode rather than a filmstrip. Aspect fidelity is
 * the one-up view's job — it is showing the whole capture, full bleed, directly
 * above this. The rail is a scrubber, and an even pitch is what makes it
 * scannable. It is also what iOS does everywhere: the Photos grid is square and
 * centre-cropped whatever the shot, and its one-up filmstrip is uniform tiles
 * with the current one *marked*, not resized.
 *
 * *Cropped* at 3:4 rather than square — the iOS convention tilted portrait,
 * since every capture here is. Square would read as a photo library; this reads
 * as a stack of wallpapers, which is what they are.
 *
 * 41 wide rather than the 39 a 3:4 *frame* would be: the 2px button border and
 * the 2px of selection-ring padding take 4px off each edge, and it is the
 * picture that has to be 3:4, since the picture is the part anyone looks at.
 *
 * That lands the frame at 52 tall and 41 wide — over the 44px minimum touch
 * target on one axis and 3px under it on the other, which is as close as a 3:4
 * box gets without the picture driving the width somewhere it should not go.
 * The shortfall is also bounded by the rail being a convenience rather than the
 * only way through the stack: the gallery pages with a swipe across the
 * full-screen image, which is a target the size of the screen.
 *
 * The desktop rail keeps its own 80×56: that pitch is what the magnification
 * field's fit and geometry are reckoned off.
 */
const MOBILE_FRAME_CLASS = "h-[52px] w-[41px]"

/**
 * The selection ring travelling — *and* the rail scrolling to meet it.
 *
 * The two share this curve, and sharing it is the whole reason the ring holds
 * still. Step through the middle of a long stack and the ring moves one pitch
 * down the content while the rail scrolls one pitch up underneath, so its
 * position on screen is
 *
 *     centre + pitch × (ring progress − scroll progress)
 *
 * — zero for every frame of the step, but only while those two progresses are
 * the same function of time. They were not: this drove the ring, and the rail
 * used `scrollTo({ behavior: "smooth" })`, which is the browser's own curve of
 * its own length. The difference is a visible excursion, the ring bulging off
 * centre and crawling back, and at a 100ms wheel-step interval against a 280ms
 * spring the steps overlap and it compounds.
 *
 * So: one object, two readers, and they must not drift apart. Give the scroll
 * its own tier and the artefact comes straight back.
 *
 * Nothing here pins the ring at the ends of the stack, and nothing should. The
 * scroll target is clamped there, so the rail travels less than a pitch and the
 * ring takes up exactly the shortfall — which is the arithmetic above still
 * holding, not an exception to it.
 */
const SELECTION_SPRING = { type: "spring", duration: 0.28, bounce: 0 } as const
/**
 * Carries the field in and out on enter/leave.
 *
 * The only thing here that springs. The cursor is already a continuous input, so
 * tracking is written straight through — springing the pointer would only put
 * the frames behind it. What does need easing is the field switching on and off,
 * which the cursor position cannot express.
 *
 * Driven imperatively rather than through `useSpring` so leaving mid-bloom can
 * stop the inbound animation and hand its velocity to the outbound one.
 */
const FIELD_SPRING = { type: "spring", duration: 0.22, bounce: 0 } as const

/**
 * Raised cosine, on normalised distance from the cursor.
 *
 * Both the value *and* the slope are zero at the far edge, which is the whole
 * reason to prefer it over the three-step lookup this replaced (or over a plain
 * cosine, whose slope at the edge is not zero). A frame entering the field
 * starts moving from a standstill, so there is no line down the rail where the
 * effect visibly switches on.
 */
const falloff = (distance: number) => (distance >= 1 ? 0 : (1 + Math.cos(Math.PI * distance)) / 2)

/**
 * Where a fractional slot sits in the rail's own layout.
 *
 * Layout values only — no magnification, which is what makes it the right
 * measure for a FLIP: both geometries have to be read the same way, and the
 * field is not part of either.
 *
 * Extrapolates rather than clamps at the ends, off the end pair's own spacing,
 * and off `pitch` when there is only one frame to go on. Deleting the newest
 * capture leaves the ring standing on a slot that no longer exists; a clamp
 * would put it on its destination before the spring had drawn a frame.
 */
function slotCenter(centers: number[], position: number, pitch: number): number {
  const count = centers.length
  if (count === 0) return 0
  const first = centers[0] ?? 0
  if (count === 1) return first + position * pitch
  const lower = Math.min(Math.max(Math.floor(position), 0), count - 2)
  const lowerCenter = centers[lower] ?? 0
  return lowerCenter + ((centers[lower + 1] ?? 0) - lowerCenter) * (position - lower)
}

/**
 * Which slot a delete took out, or null if this commit was not one.
 *
 * Read off the ids rather than handed down as a prop, for the reason `readFrames`
 * gives about the registry it replaced: a second copy of the truth is a thing
 * that can disagree with the first. Both galleries delete the capture on screen
 * and only that, so the strip does not need telling — the list before and the
 * list after say it exactly.
 *
 * Exactly one removal, in order. A commit that adds, reorders, or drops two is
 * not a delete's motion and falls back to the jump.
 */
function removedSlot(before: string[], after: string[]): number | null {
  if (after.length !== before.length - 1) return null
  for (let index = 0; index < after.length; index += 1) {
    if (after[index] !== before[index]) {
      // Everything from here on has to be the tail of `before`, or this is a
      // reorder wearing a delete's length.
      for (let rest = index; rest < after.length; rest += 1) {
        if (after[rest] !== before[rest + 1]) return null
      }
      return index
    }
  }
  return after.length
}

/**
 * How far each end of the rail fades out, so a long stack dissolves at the edges
 * instead of being sliced off by the scroller.
 *
 * 32 sits inside two separate clearances, and needs to stay inside both. The
 * column's `py-16` parks the outermost frame 64px clear of the rail's edge at
 * either end of the travel, so at rest the fade is spent entirely on blank
 * padding and the newest and oldest captures keep full strength — no scroll
 * listener needed to gate it. The field then pulls that frame up to 24.1px of
 * that clearance on hover (see the column's note), leaving 39.9px, which 32 is
 * still under. Go past 40 and pointing at the rail starts washing out the top of
 * the stack; go past 64 and it is washed out even standing still.
 */
const RAIL_FADE_PX = 32

/**
 * The ramp — a raised cosine, not a straight line.
 *
 * Same curve and the same reason as `falloff` above: value *and* slope both
 * reach zero at the transparent end, so a thumbnail entering the fade starts
 * dimming from a standstill rather than stepping onto a slope, and the opaque end
 * meets full strength without a crease. A linear alpha ramp corners at both.
 * Spelled out as stops because a CSS gradient only interpolates linearly between
 * the ones it is given; these are (1 − cos πt)/2 sampled at the quarters.
 *
 * A mask rather than a scrim painted in `--background`, which is the choice
 * controls-panel made and documented. That panel had a colour picker opening out
 * of its box and a mask would have clipped it; this rail already clips on both
 * axes, so a mask takes nothing away — and it costs no extra node, no second copy
 * of the background colour, and stays right in either appearance.
 */
const RAIL_FADE_MASK = [
  "linear-gradient(to bottom,",
  "rgba(0,0,0,0) 0px,",
  `rgba(0,0,0,0.15) ${RAIL_FADE_PX * 0.25}px,`,
  `rgba(0,0,0,0.5) ${RAIL_FADE_PX * 0.5}px,`,
  `rgba(0,0,0,0.85) ${RAIL_FADE_PX * 0.75}px,`,
  `rgba(0,0,0,1) ${RAIL_FADE_PX}px,`,
  `rgba(0,0,0,1) calc(100% - ${RAIL_FADE_PX}px),`,
  `rgba(0,0,0,0.85) calc(100% - ${RAIL_FADE_PX * 0.75}px),`,
  `rgba(0,0,0,0.5) calc(100% - ${RAIL_FADE_PX * 0.5}px),`,
  `rgba(0,0,0,0.15) calc(100% - ${RAIL_FADE_PX * 0.25}px),`,
  "rgba(0,0,0,0) 100%)",
].join(" ")

interface FrameValues {
  transform: MotionValue<string>
}

const IDENTITY_TRANSFORM = "translate3d(0, 0px, 0) scale(1)"

/**
 * The gallery's filmstrip.
 *
 * Desktop gets a restrained Dock magnification. The frame under the cursor
 * stays anchored while its neighbours move away by exactly the extra height the
 * scaled cards need, so the effect reads as a stack making room rather than as
 * thumbnails overlapping one another. Mobile is deliberately plain: there are no
 * hover handlers, transforms, or hover-only styles in that branch.
 *
 * The magnification is a continuous function of *where the cursor is*, not a
 * reaction to which thumbnail it entered, and that distinction is the entire
 * fix. Driving it from per-item `mouseenter` closed a loop: hit testing uses the
 * transformed box, so scaling and displacing the frames slid new elements under
 * a cursor that had not moved, which fired fresh enter events, which changed the
 * geometry again. The strip oscillated while standing still. Here the field is
 * computed from `offsetTop`/`offsetHeight` — layout values that our own
 * transforms cannot perturb, the same reason `use-proximity-hover` measures that
 * way — so there is no feedback path left to close.
 *
 * It also never re-renders while you track across it. The pointer position and
 * one 0→1 strength live in motion values; a single subscriber recomputes the
 * whole field in one O(n) pass and writes one composed transform motion value
 * per frame, and React sits it out entirely.
 */
export function GalleryThumbnailStrip({
  captures,
  currentIndex,
  onSelect,
  orientation,
}: GalleryThumbnailStripProps) {
  const prefersReducedMotion = useReducedMotion()
  const scrollRef = useRef<HTMLElement>(null)
  const valueRefs = useRef<(FrameValues | null)[]>([])
  const selectionTransition = prefersReducedMotion ? { duration: 0 } : SELECTION_SPRING
  const isVertical = orientation === "vertical"

  // Both orientations run in stored order. The rail reads top to bottom as the
  // strip reads left to right — oldest first, so the capture you just took is
  // the last one on the stack rather than the first. The rail used to invert,
  // which is a list's order and not a timeline's: it put the two galleries at
  // odds about which way time ran, and it meant every index arriving here had to
  // be flipped on the way in and back out again. One order leaves nothing to
  // map. The index a capture has in state is the index it has in the DOM, in the
  // value registry and under the ring.

  /**
   * The frames, in display order, read straight out of the DOM.
   *
   * This used to be a registry the frames wrote themselves into from a callback
   * ref, and a delete took it apart. Every frame below the deleted one changes
   * index, which changes the identity of its inline ref callback, and
   * React answers that by running the old cleanup and the new callback — but
   * interleaved through the tree, not in two clean passes. The cleanup closes
   * over the old index, so it lands on a slot a neighbour has already claimed.
   * Guarding the cleanup on identity fixes some of the orderings and not all of
   * them; the registry came back from a delete holed either way, `measure` then
   * skipped the missing frames, and the pitch it derived from the survivors was
   * a multiple of the real one. The field — and the ring, which now reads the
   * same geometry — were laid out against a strip that did not exist.
   *
   * DOM order *is* display order, by construction, and it cannot be stale: there
   * is no second copy to keep in step. So there is nothing left to corrupt.
   */
  const readFrames = useCallback(
    () =>
      scrollRef.current
        ? Array.from(scrollRef.current.querySelectorAll<HTMLButtonElement>("[data-thumbnail-frame]"))
        : [],
    [],
  )

  // Item centres in the scroller's content space, plus the frame height and the
  // centre-to-centre pitch, all measured rather than assumed.
  const geometryRef = useRef({
    centers: [] as number[],
    /** The frame's extent along the strip's own axis: its height on the rail, its width on the strip. */
    size: DESKTOP_FALLBACK_HEIGHT,
    pitch: DESKTOP_FALLBACK_HEIGHT + FRAME_FALLBACK_GAP,
    /** Its offset on the other axis, which is what places the strip's ring. */
    cross: 0,
  })
  const pointerRef = useRef(0)
  const clientYRef = useRef<number | null>(null)
  const activeRef = useRef(false)
  /**
   * The image index a pointer press just aimed at, for the centring effect below
   * to decline.
   *
   * An index rather than a boolean latch. Pressing the frame that is already
   * selected changes no state, so the effect never runs to clear a flag, and the
   * stale `true` would then swallow the next wheel step's scroll.
   */
  const pointerSelectRef = useRef<number | null>(null)
  const scaleScratch = useRef<number[]>([])
  const spreadScratch = useRef<number[]>([])

  const strength = useMotionValue(0)
  const strengthAnimation = useRef<AnimationPlaybackControls | null>(null)

  const driveStrength = useCallback(
    (target: number) => {
      strengthAnimation.current?.stop()
      strengthAnimation.current = animate(strength, target, FIELD_SPRING)
    },
    [strength],
  )

  useEffect(() => () => strengthAnimation.current?.stop(), [])

  /**
   * The rail's own scroll offset, as a motion value.
   *
   * The same shape as `strength` above, for the same reason: a spring that has
   * to survive being re-aimed mid-flight. Wheel steps arrive every 100ms and the
   * spring runs for 280, so re-targeting is the normal case rather than the edge
   * one — and re-targeting a live `MotionValue` is what carries the velocity
   * across, which is the only way this stays in step with the ring's layout
   * animation, since Framer re-aims that one the same way.
   */
  const scrollOffset = useMotionValue(0)
  const scrollAnimation = useRef<AnimationPlaybackControls | null>(null)

  const scrollAxis = isVertical ? ("scrollTop" as const) : ("scrollLeft" as const)

  /**
   * Where the selection ring is, as a *fractional frame index*.
   *
   * The ring used to be a `layoutId` element living inside the selected frame,
   * and that is the one thing it cannot be. Framer moves a shared element by
   * measuring both boxes on screen and rendering the difference as a translate
   * on the incoming one — then dividing that screen-space distance by
   * `treeScale` to express it in the element's own coordinate space. `treeScale`
   * only accumulates ancestors that are themselves running a layout animation,
   * and these frames are not: their scale is a motion value we write by hand. So
   * the divisor stayed 1 while the real parent was magnified by up to 1.34, and
   * the ring travelled 34% too far — visibly shooting *past* the frame it was
   * leaving, in the opposite direction, before the spring dragged it back. The
   * `origin-right` below compounded it sideways: the projection assumes an
   * origin of 50% unless it is handed `originX` as a motion prop.
   *
   * There is no tuning out of that. A projected child of an element scaled by
   * hand is outside what the projection can model at all. So the ring comes out
   * of the frame and is placed directly, in the rail's own coordinate space, off
   * the geometry `applyField` has already measured.
   *
   * Fractional, and interpolated across the two frames it lies between, rather
   * than a pixel position sprung straight at a target. At rest that puts it
   * exactly on a frame; mid-travel it reads the *current* magnified geometry of
   * both neighbours, so it stays glued to the strip while the strip is still
   * opening and closing under the cursor. A sprung pixel target would come
   * unstuck from the frames the moment the mouse moved.
   *
   * Same spring as the scroll above, for the reason SELECTION_SPRING gives: this
   * is the ring's half of `centre + pitch × (ring progress − scroll progress)`.
   */
  const selection = useMotionValue(0)
  const selectionAnimation = useRef<AnimationPlaybackControls | null>(null)
  /** −1 so the first aim is a jump, not a flight up from frame zero. */
  const selectionCountRef = useRef(-1)
  const ringTransform = useMotionValue(IDENTITY_TRANSFORM)

  useEffect(() => () => selectionAnimation.current?.stop(), [])

  /**
   * The rail closing over a deleted capture — a FLIP, and it has to be one.
   *
   * The rail is a plain flex column, so removing a capture re-lays the survivors
   * out between one paint and the next and there is nothing to watch. Framer's
   * `layout` cannot draw that crossing here for the same reason the ring had to
   * leave the frame: these frames carry a hand-written scale, which `treeScale`
   * cannot see, so a projection would travel by the wrong multiple. So the
   * browser is allowed to close the gap instantly and this puts it back — every
   * frame offset by exactly how far the delete moved it, sprung to zero.
   *
   * Measured deltas rather than "one pitch upward below the cut", which is what
   * this was first and what the column's `justify-center` quietly falsified: a
   * stack shorter than the rail is centred in it, so losing a capture also
   * drifts *everything above* the cut half a pitch down. The two halves close
   * over the gap symmetrically, and only a FLIP off the real geometry knows
   * that. Once the stack is long enough to scroll, the centring term goes to
   * zero on its own and this becomes the plain one-pitch rise again.
   *
   * `flip` is the progress, 1 at the seam and 0 when it has landed. It rides
   * `applyField`'s existing pass, so the magnification and the collapse compose
   * into the single transform each frame already gets.
   */
  const flip = useMotionValue(0)
  const flipFramesRef = useRef<number[]>([])
  const flipRingRef = useRef(0)
  const flipAnimation = useRef<AnimationPlaybackControls | null>(null)
  /** The slot a delete emptied, handed from the measuring pass to the aiming one. */
  const removedRef = useRef<number | null>(null)

  useEffect(() => () => flipAnimation.current?.stop(), [])

  /** The stack as of the last commit, so a delete can be read off rather than passed in. */
  const previousCapturesRef = useRef<Capture[]>([])

  /**
   * The thumbnail you just deleted, leaving.
   *
   * The rail's half of CaptureDismissal, and deliberately the same exit: the
   * same `dismissMs` on the same `dismissFadeEase`, two commits, one property.
   * It is one picture going, seen on two surfaces at once — giving the small
   * copy a curve of its own would make it a second event.
   *
   * A fade and nothing else, for the reason the full-screen exit records: the
   * recede was tried there and removed, and adding one here only to the
   * thumbnail would put the two out of step again.
   *
   * Not a frame. It carries no `data-thumbnail-frame`, registers no motion value
   * and takes no part in the field — it is a still, placed once at the slot the
   * deleted capture had and left there while the rail closes over it. Anything
   * that stayed in the list would have to be skipped by every index this
   * component keeps, which is the registry bug `readFrames` exists to have
   * already fixed.
   */
  const [departing, setDeparting] = useState<{
    key: number
    capture: Capture
    along: number
    cross: number
  } | null>(null)
  const [departed, setDeparted] = useState(false)
  const departingKeyRef = useRef(0)

  // Two commits, exactly as CaptureDismissal does it: the first paints the still
  // over the slot the frame occupied a frame ago, the second starts the fade.
  // Set together there is no "from" to transition out of and it simply blinks.
  useEffect(() => {
    if (!departing) return
    const start = requestAnimationFrame(() => setDeparted(true))
    const clear = window.setTimeout(() => setDeparting(null), galleryEffects.dismissMs + 60)
    return () => {
      cancelAnimationFrame(start)
      window.clearTimeout(clear)
    }
  }, [departing])

  useMotionValueEvent(scrollOffset, "change", (value) => {
    const scroller = scrollRef.current
    if (!scroller) return
    scroller[scrollAxis] = value
  })

  /**
   * Hand the rail back to the browser.
   *
   * Native smooth scroll cancels itself the moment you touch the wheel; ours
   * will happily keep writing `scrollTop` over the top of you, so the release
   * has to be explicit.
   */
  const stopScroll = useCallback(() => {
    scrollAnimation.current?.stop()
    scrollAnimation.current = null
  }, [])

  useEffect(() => () => scrollAnimation.current?.stop(), [])

  const registerValues = useCallback((index: number, values: FrameValues | null) => {
    valueRefs.current[index] = values
  }, [])

  const measure = useCallback(() => {
    const centers: number[] = []
    let size = isVertical ? DESKTOP_FALLBACK_HEIGHT : MOBILE_FALLBACK_WIDTH
    // Where the frames sit on the *other* axis, which only the strip needs: its
    // ring is placed from the top of a scroller the frames are centred in, where
    // the rail's is pinned to an edge by `right-4`.
    let cross = 0

    const frames = readFrames()
    for (let index = 0; index < frames.length; index += 1) {
      const node = frames[index]
      // offsetTop/offsetLeft, not getBoundingClientRect: these are layout
      // values, immune to the transforms this component is in the middle of
      // applying.
      centers[index] = isVertical
        ? node.offsetTop + node.offsetHeight / 2
        : node.offsetLeft + node.offsetWidth / 2
      size = isVertical ? node.offsetHeight : node.offsetWidth
      cross = isVertical ? node.offsetLeft : node.offsetTop
    }

    const pitch =
      centers.length > 1 && centers[0] !== undefined && centers[1] !== undefined
        ? centers[1] - centers[0]
        : size + FRAME_FALLBACK_GAP

    geometryRef.current = { centers, size, pitch, cross }
  }, [isVertical, readFrames])

  /**
   * One pass: scale every frame from its distance to the cursor, then place it.
   *
   * Placement is a prefix sum. Between neighbours i and i+1 the scaled cards need
   * `height × (scaleᵢ + scaleᵢ₊₁ − 2) / 2` of extra separation to keep the gap
   * they had, so the running total of that is where each frame's centre has to
   * end up. Subtracting the total *at the cursor* — interpolated across the pair
   * the cursor falls between, which is what keeps this continuous instead of
   * snapping at frame boundaries — pins the point under the cursor and lets the
   * strip open away from it in both directions.
   */
  const applyField = useCallback(() => {
    const { centers, size, pitch, cross } = geometryRef.current
    const count = centers.length
    if (count === 0) return

    const amount = strength.get()
    const pointer = pointerRef.current
    const reach = pitch * DESKTOP_SPREAD

    const scales = scaleScratch.current
    scales.length = count
    for (let index = 0; index < count; index += 1) {
      const center = centers[index]
      scales[index] =
        center === undefined
          ? 1
          : 1 + (DESKTOP_MAX_SCALE - 1) * falloff(Math.abs(pointer - center) / reach) * amount
    }

    const spread = spreadScratch.current
    spread.length = count
    spread[0] = 0
    for (let index = 0; index < count - 1; index += 1) {
      spread[index + 1] =
        spread[index] + (size * (scales[index] + scales[index + 1] - 2)) / 2
    }

    const first = centers[0] ?? 0
    const position = Math.min(Math.max((pointer - first) / pitch, 0), count - 1)
    const pair = Math.min(Math.floor(position), Math.max(count - 2, 0))
    const within = position - pair
    const anchor =
      count > 1 ? spread[pair] + within * (spread[pair + 1] - spread[pair]) : 0

    // How much of a delete's collapse is still to run. See `flip`.
    const closing = flip.get()
    const offsets = flipFramesRef.current

    for (let index = 0; index < count; index += 1) {
      const values = valueRefs.current[index]
      if (!values) continue
      const along = spread[index] - anchor + (offsets[index] ?? 0) * closing
      values.transform.set(
        isVertical
          ? `translate3d(0, ${along}px, 0) scale(${scales[index]})`
          : `translate3d(${along}px, 0, 0)`,
      )
    }

    // The ring, out of the same pass and the same numbers: whatever the field is
    // doing to the two frames it lies between, it is doing to the ring.
    //
    // Allowed one slot past either end, where a plain clamp used to hold it.
    // Deleting the newest capture leaves the ring standing on a slot that no
    // longer exists, and clamping it to the last frame put it on its
    // destination before the spring had drawn a frame of the trip. Past the end
    // the position extrapolates off the end pair's own spacing, which is the
    // pitch the field currently has there.
    const ringPosition = Math.min(Math.max(selection.get(), -1), count)
    const lower = Math.min(Math.max(Math.floor(ringPosition), 0), Math.max(count - 2, 0))
    const upper = Math.min(lower + 1, count - 1)
    const between = ringPosition - lower
    const lowerCenter = (centers[lower] ?? 0) + spread[lower] - anchor
    // A rail of one has no pair to read a slope off, so the slot below it is
    // synthesised from the pitch. That is the two-captures-down-to-one case, and
    // without it the ring arrives on the survivor with nothing drawn.
    const upperCenter =
      count > 1 ? (centers[upper] ?? 0) + spread[upper] - anchor : lowerCenter + pitch
    // Size does not extrapolate with position: off the end there is no frame to
    // be the size of, and running the line on would carry the ring past the
    // field's own peak.
    const blend = Math.min(Math.max(between, 0), 1)
    const nextRingScale = scales[lower] + (scales[upper] - scales[lower]) * blend
    // The ring's box is the frame's own, pinned to the rail's top, so the
    // translate carries its centre to the frame's centre.
    const ringAlong =
      lowerCenter + (upperCenter - lowerCenter) * between - size / 2 + flipRingRef.current * closing
    // The rail's ring is pinned to an edge by `right-4`, so only the travel axis
    // is written. The strip's is placed from `left-0 top-0` and carries the
    // measured cross offset with it, which saves writing a second style that
    // would have to be kept in step with this one.
    ringTransform.set(
      isVertical
        ? `translate3d(0, ${ringAlong}px, 0) scale(${nextRingScale})`
        : `translate3d(${ringAlong}px, ${cross}px, 0)`,
    )
  }, [flip, isVertical, ringTransform, selection, strength])

  // The strength spring is what carries the field in and out; every frame of it
  // needs the whole field recomputed, since the scales it multiplies also drive
  // the displacement.
  useMotionValueEvent(strength, "change", applyField)

  // And the ring's travel needs the same, for the same reason: the frames it is
  // interpolating between are wherever the field has just put them.
  useMotionValueEvent(selection, "change", applyField)

  // The rail closing over a delete is the third input to the same pass.
  useMotionValueEvent(flip, "change", applyField)

  const trackPointer = useCallback((clientY: number) => {
    const nav = scrollRef.current
    if (!nav) return
    const rect = nav.getBoundingClientRect()
    // Item centres are layout values while the cursor is in viewport space. If an
    // ancestor is scaled, the two spaces differ by exactly this ratio.
    const viewportScale = nav.offsetHeight > 0 ? rect.height / nav.offsetHeight : 1
    clientYRef.current = clientY
    pointerRef.current = (clientY - rect.top) / (viewportScale || 1) + nav.scrollTop
  }, [])

  const handlePointerMove = (event: React.PointerEvent) => {
    // The desktop/mobile split is a 768px width check, so a touchscreen laptop
    // lands on this rail. A tap should not magnify anything.
    if (event.pointerType !== "mouse") return
    trackPointer(event.clientY)
    if (!activeRef.current) {
      activeRef.current = true
      driveStrength(1)
    }
    applyField()
  }

  const releaseField = useCallback(() => {
    if (!activeRef.current) return
    activeRef.current = false
    clientYRef.current = null
    driveStrength(0)
  }, [driveStrength])

  /**
   * Blur, which is the keyboard leaving a frame — and only that.
   *
   * The same guard as `focusField`'s first one, and it has to be here for the
   * same reason: `releaseField` answers two different questions, and a mouse
   * click asks the wrong one. Clicking a second frame blurs the first, and the
   * blur was tearing the whole field down — strength to zero, `clientYRef`
   * cleared — with the cursor still sitting in the rail. Focus then landing on
   * the new frame is refused, correctly, so nothing switched the field back on
   * and it stayed dark until the mouse moved.
   *
   * This is older than the guards above; those only exposed it. `focusField`
   * used to re-activate unconditionally, so the release and the re-activation
   * cancelled out within one click and the field never visibly dropped.
   *
   * Leaving with the pointer still goes through `releaseField` directly, on the
   * rail's own `pointerleave`. That is the event that means the cursor is gone.
   */
  const blurField = useCallback(() => {
    if (clientYRef.current !== null) return
    releaseField()
  }, [releaseField])

  /**
   * Keyboard parity: focusing a frame puts the cursor at its centre.
   *
   * Both guards are load-bearing, and the first is the one that fixes the click.
   * A mouse press focuses the button — that is Chrome's behaviour, not ours — so
   * without them a click re-anchored the field from wherever the cursor actually
   * was to the frame's exact centre, instantly and with no transition, because
   * these are motion values written straight through. Clicking a frame's top edge
   * moved the whole strip. It also cleared `clientYRef`, which is what the scroll
   * listener needs to keep tracking, so the field then froze for the length of the
   * scroll and snapped back the moment the mouse moved a pixel.
   *
   * A live cursor in the rail therefore owns the field outright: it is a stronger
   * claim than focus, and a click is always preceded by `pointermove` in here, so
   * the ref is the reliable signal. That also settles tabbing while the mouse
   * rests over the rail, where the cursor is still what the eye is following.
   *
   * `:focus-visible` then catches what the cursor check cannot see — a tap on a
   * touchscreen laptop, which lands on this rail because the desktop/mobile split
   * is a width check, and which should magnify nothing.
   */
  const focusField = (index: number, node: HTMLElement) => {
    if (clientYRef.current !== null) return
    if (!node.matches(":focus-visible")) return
    const center = geometryRef.current.centers[index]
    if (center === undefined) return
    pointerRef.current = center
    clientYRef.current = null
    if (!activeRef.current) {
      activeRef.current = true
      driveStrength(1)
    }
    applyField()
  }

  // useLayoutEffect, because the ring is placed from this measurement and has
  // nowhere sensible to sit before it. Left in an effect, the first painted
  // frame of a freshly opened gallery drew the ring at the top of the rail.
  useLayoutEffect(() => {
    if (prefersReducedMotion) return

    // Read before `measure` overwrites them: a FLIP needs the geometry the last
    // paint was drawn against. `measure` builds a fresh array each time, so
    // holding the old one is safe.
    const previousCenters = geometryRef.current.centers
    const previousOffsets = flipFramesRef.current
    const previousCaptures = previousCapturesRef.current
    previousCapturesRef.current = captures
    const removed = removedSlot(
      previousCaptures.map((capture) => capture.id),
      captures.map((capture) => capture.id),
    )
    removedRef.current = removed

    // A delete leaves the value registry longer than the strip. Positions are
    // keyed by index, so trimming is all the compaction it needs.
    valueRefs.current.length = captures.length
    measure()

    if (removed !== null) {
      const { centers, pitch } = geometryRef.current
      // Where each frame *was* — including any collapse it had not finished, so
      // a second delete inside the spring picks the pictures up where they had
      // actually got to instead of where their slots were.
      const residual = flip.get()
      const offsets: number[] = []
      for (let index = 0; index < centers.length; index += 1) {
        const before = index < removed ? index : index + 1
        const drawn = previousCenters[before]
        offsets[index] =
          drawn === undefined ? 0 : drawn + (previousOffsets[before] ?? 0) * residual - (centers[index] ?? 0)
      }
      flipFramesRef.current = offsets

      // The ring's own delta, off the same two geometries. It is not on a
      // picture — it is on a *slot*, and the slot it is on is `selection`, which
      // has not been renumbered yet. So: where that slot was, against where the
      // renumbered slot is. `clamp(held − removed, 0, 1)` is the renumbering,
      // and it is the identity in the ordinary case of deleting the capture the
      // ring is resting on.
      const held = selection.get()
      const settled = held - Math.min(Math.max(held - removed, 0), 1)
      flipRingRef.current =
        slotCenter(previousCenters, held, pitch) +
        flipRingRef.current * residual -
        slotCenter(centers, settled, pitch)
      selection.jump(settled)

      flipAnimation.current?.stop()
      flip.jump(1)
      flipAnimation.current = animate(flip, 0, SELECTION_SPRING)

      // The picture that left, held over the slot it had. Placed off the *old*
      // geometry for the same reason the ring's delta is: that is where the last
      // paint put it.
      const leaving = previousCaptures[removed]
      if (leaving) {
        departingKeyRef.current += 1
        setDeparted(false)
        setDeparting({
          key: departingKeyRef.current,
          capture: leaving,
          along: slotCenter(previousCenters, removed, pitch) - geometryRef.current.size / 2,
          cross: geometryRef.current.cross,
        })
      }
    }

    applyField()
  }, [applyField, captures, flip, measure, prefersReducedMotion, selection])

  // And again once the frames have re-registered their motion values, which they
  // do in an effect and therefore after the layout pass above. A delete renumbers
  // every index below it, so the pass above writes the new geometry into
  // the old numbering; this is the one that lands it on the right frames. It is
  // the same idempotent pass, so on every other commit it changes nothing.
  useEffect(() => {
    if (prefersReducedMotion) return
    applyField()
  }, [applyField, captures.length, prefersReducedMotion])

  useEffect(() => {
    const nav = scrollRef.current
    if (!nav || prefersReducedMotion) return

    // Selecting a frame scrolls the rail, which moves the frames past a
    // stationary cursor. That is a real change in proximity, so the field should
    // follow it rather than be suppressed — recompute from the last cursor
    // position on every scroll frame. Rail only: the strip has no field, and no
    // cursor to have moved relative to.
    const handleScroll = () => {
      if (!activeRef.current || clientYRef.current === null) return
      trackPointer(clientYRef.current)
      applyField()
    }
    if (isVertical) nav.addEventListener("scroll", handleScroll, { passive: true })

    // The re-measure *is* for both. The strip's ring is placed from these
    // numbers now, so a rotation or a keyboard opening under it has to move the
    // ring with the frames.
    if (typeof ResizeObserver === "undefined") {
      return () => nav.removeEventListener("scroll", handleScroll)
    }

    let frame: number | null = null
    const observer = new ResizeObserver(() => {
      if (frame !== null) cancelAnimationFrame(frame)
      frame = requestAnimationFrame(() => {
        frame = null
        measure()
        applyField()
      })
    })
    observer.observe(nav)

    return () => {
      nav.removeEventListener("scroll", handleScroll)
      observer.disconnect()
      if (frame !== null) cancelAnimationFrame(frame)
    }
  }, [applyField, isVertical, measure, prefersReducedMotion, trackPointer])

  /**
   * A hand on the rail outranks the centring.
   *
   * Wheel input over the rail belongs to its native scroller and deliberately
   * does not change the selected capture — the gallery's own wheel handler bows
   * out for this element. The centring spring has to bow out too, and unlike
   * the `scrollTo` it replaced it will not do so by itself: a browser cancels
   * its smooth scroll on user input, whereas ours would go on writing
   * `scrollTop` underneath a reader who is scrolling somewhere else.
   *
   * Both orientations, since the horizontal strip is dragged rather than
   * wheeled and `touchstart` is where that begins.
   */
  useEffect(() => {
    const nav = scrollRef.current
    if (!nav || prefersReducedMotion) return

    nav.addEventListener("wheel", stopScroll, { passive: true })
    nav.addEventListener("touchstart", stopScroll, { passive: true })
    return () => {
      nav.removeEventListener("wheel", stopScroll)
      nav.removeEventListener("touchstart", stopScroll)
    }
  }, [prefersReducedMotion, stopScroll])

  /**
   * Keep the current frame centred — unless you pointed at it.
   *
   * The rail has to follow a selection it did not cause: step with the wheel or
   * the arrow keys and the current capture would otherwise drift off the end.
   * A press is the one case where it must not, because the frame you pressed was
   * by definition already under your cursor, and scrolling it to the centre slides
   * the entire strip out from under a hand that has not moved. Nothing needs
   * revealing after a direct hit.
   *
   * Read and cleared unconditionally, which is what makes a stale value harmless:
   * a press that never became a selection — press, drag off the frame, release —
   * is discarded by the next index change instead of suppressing it.
   */
  // useLayoutEffect, not useEffect, and the phase is the point. Framer starts
  // the ring's projection animation in the layout phase; starting the scroll a
  // frame later leaves the two offset by 16ms at the head of the spring, which
  // is exactly where its slope is steepest and so exactly where the offset
  // shows. It is also the right phase on its own terms — everything read below
  // is layout.
  useLayoutEffect(() => {
    const pointerSelected = pointerSelectRef.current
    pointerSelectRef.current = null

    // Consumed rather than merely read: this effect also runs on a plain step
    // through the rail, where the measuring pass above has not run at all and a
    // leftover slot would send the ring off on a delete it had already drawn.
    const removed = removedRef.current
    removedRef.current = null

    // The ring is aimed above the pointer check, and unconditionally: a press is
    // the one selection the rail must *not* scroll to reveal, and it is still a
    // selection the ring has to travel to. Only the scroll below is declined.
    if (!prefersReducedMotion) {
      const target = currentIndex
      // A delete, and it is the one count change that *is* a travel.
      //
      // This used to be folded in with every other renumbering below and jumped,
      // on the reading that a shorter list only relabels the frame the ring is
      // standing on. That is true of the pictures and false of the ring: the ring
      // is on a slot, the pass above has already left it standing exactly where
      // it was drawn, and the capture it belongs to is now the one a slot up.
      // There is a full pitch of travel there and the jump was eating it.
      if (removed !== null) {
        selectionCountRef.current = captures.length
        selectionAnimation.current = animate(selection, target, SELECTION_SPRING)
      } else if (selectionCountRef.current !== captures.length) {
        // Anything else that changes the count — the first aim above all —
        // renumbers every index under the ring with no travel behind it. The
        // frame it is on has simply been relabelled, and springing across that
        // would send it on a lap of the rail.
        selectionCountRef.current = captures.length
        selectionAnimation.current?.stop()
        selectionAnimation.current = null
        selection.jump(target)
        applyField()
      } else {
        // Re-aimed rather than restarted, exactly like the scroll below: wheel
        // steps arrive every 100ms against a 280ms spring, and handing the live
        // value a new target is what carries the velocity across.
        selectionAnimation.current = animate(selection, target, SELECTION_SPRING)
      }
    }

    const scroller = scrollRef.current
    const item = readFrames()[currentIndex]
    if (!scroller || !item) return
    if (pointerSelected === currentIndex) return

    const itemCenter =
      orientation === "vertical"
        ? item.offsetTop + item.offsetHeight / 2
        : item.offsetLeft + item.offsetWidth / 2
    const viewportSize = orientation === "vertical" ? scroller.clientHeight : scroller.clientWidth
    const maxScroll =
      orientation === "vertical"
        ? scroller.scrollHeight - scroller.clientHeight
        : scroller.scrollWidth - scroller.clientWidth
    const target = Math.max(0, Math.min(itemCenter - viewportSize / 2, maxScroll))

    if (prefersReducedMotion) {
      stopScroll()
      scroller[scrollAxis] = target
      return
    }

    // Re-read the DOM only from rest. `jump` clears velocity, which is the
    // right thing when the rail has been sitting still or the reader dragged it
    // somewhere themselves, and precisely the wrong thing mid-step: doing it on
    // every wheel tick would zero the velocity 100ms into a 280ms spring and
    // hand the ring back the drift this whole arrangement removes.
    if (!scrollAnimation.current) scrollOffset.jump(scroller[scrollAxis])

    const controls = animate(scrollOffset, target, SELECTION_SPRING)
    scrollAnimation.current = controls
    // Guarded, because a re-aim leaves this promise behind: the identity check
    // is what stops a superseded animation from clearing its successor's slot
    // and inviting the `jump` above back in.
    controls.then(() => {
      if (scrollAnimation.current === controls) scrollAnimation.current = null
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentIndex, captures.length, orientation, prefersReducedMotion, scrollAxis, stopScroll])

  // Both orientations place their own ring now. It is a shared element only
  // under reduced motion, where nothing is writing a transform for it to fight.
  const ridesOwnRing = !prefersReducedMotion

  return (
    <nav
      ref={scrollRef}
      aria-label="Captures"
      data-gallery-thumbnail-strip={orientation}
      className={cn(
        "pointer-events-auto overscroll-contain [scrollbar-width:none] [&::-webkit-scrollbar]:hidden",
        // `relative` on both, and it is load-bearing on both: it makes the
        // scroller the offsetParent for every frame, so the measured centres,
        // the mapped cursor and the ring placed off them share one coordinate
        // space whatever the gallery wraps this in.
        "relative",
        isVertical
          ? "h-full w-32 overflow-x-hidden overflow-y-auto"
          // Equal padding top and bottom, and the bottom one is the half that
          // does the work: this bar is pinned to `bottom-0`, so its height grows
          // upward and only `pb` can move the frames. `pt` matches it so the
          // bar's own box is symmetric — which is what makes it sit centred in
          // the letterbox below the capture, rather than merely ending there.
          //
          // 14px, because the capture above is `max-h-full` and centred, so the
          // band between its bottom edge and the screen's is 80px on a phone —
          // 14 + the 52px frame + 14. The old 8/12 split put 16 above the frame
          // and 12 below it, which is the bottom-heavy sit you can see once you
          // look for it.
          //
          // The safe-area floor still wins on a home-indicator device, and
          // should: clearing the indicator outranks centring against it.
          : "w-full overflow-x-auto overflow-y-hidden px-3 pb-[max(0.875rem,env(safe-area-inset-bottom))] pt-3.5",
      )}
      // On the scroller, not on the column inside it: a mask paints against the
      // element's own border box, so here it stays pinned to the rail's two edges
      // while the frames travel underneath. Hung on the column it would scroll
      // away with the content and fade the ends of the stack, not of the view.
      //
      // Vertical only. The horizontal strip has 4px of side padding against this
      // rail's 64, so a fade there has nowhere to be spent and would dim the first
      // and last capture while the strip sits at rest.
      style={
        isVertical ? { WebkitMaskImage: RAIL_FADE_MASK, maskImage: RAIL_FADE_MASK } : undefined
      }
      onClick={(event) => event.stopPropagation()}
      onPointerMove={isVertical && !prefersReducedMotion ? handlePointerMove : undefined}
      onPointerLeave={isVertical && !prefersReducedMotion ? releaseField : undefined}
    >
      <div
        className={cn(
          "flex",
          isVertical
            // py-16 rather than py-10: the frames at the ends of a long strip are
            // pushed ~35px outward by the displacement, and a transform does not
            // extend scrollHeight, so anything past the padding is simply clipped.
            // gap-0, and it is deliberate rather than an omission: the frames
            // already carry their own gap. Flex spaces *border* boxes, and the
            // picture sits well inside its button — 2px transparent border plus
            // 4px padding on the rail, 2px plus 2px on the strip — so two
            // touching buttons still show 12px of daylight between pictures on
            // the rail and 8px on the strip, which is the spacing. Neither inset
            // is free to move: the border is the focus ring and the padding is
            // the selection ring's only room. So the flex gap is what gives, and
            // at these sizes it gives entirely.
            ? "min-h-full flex-col items-end justify-center gap-0 py-16 pl-12 pr-4"
            : "w-max min-w-full items-center justify-center gap-0 px-1",
        )}
      >
        {captures.map((capture, index) => {
          return (
            <GalleryThumbnailFrame
              key={capture.id}
              capture={capture}
              index={index}
              label={`Show capture ${index + 1} of ${captures.length}`}
              selected={index === currentIndex}
              isVertical={isVertical}
              orientation={orientation}
              prefersReducedMotion={Boolean(prefersReducedMotion)}
              selectionTransition={selectionTransition}
              registerValues={registerValues}
              onSelect={() => onSelect(index)}
              // On the press, not the click: keyboard activation fires `click`
              // without a `pointerdown`, so Enter on a focused frame keeps the
              // scroll that puts it in view.
              onPressFrame={() => {
                pointerSelectRef.current = index
              }}
              onFocusFrame={focusField}
              onBlurFrame={blurField}
            />
          )
        })}
      </div>

      {/* The selection ring — a sibling of the frames rather than a child of the
          selected one. See `selection` above for why it had to leave the rail,
          and the strip's frames now write a transform of their own for exactly
          the same reason it cannot go back.

          Every number here mirrors the frame's own box and has to keep
          mirroring it: the size is the button's border box on each surface,
          `right-4` answers the rail column's `pr-4` so the two right edges
          coincide, and `origin-right` is the rail frames' own origin — which is
          what keeps that edge fixed as the ring is magnified along with them.
          The stroke and the radius scale with it exactly as they did when the
          frame carried them, because it is still one transform doing the
          scaling.

          The strip anchors at `left-0 top-0` instead and takes its cross-axis
          position from the measured geometry: its frames are centred in the
          scroller rather than pinned to an edge, so there is no inset to answer.

          Absolutely positioned inside the scroller, so it rides the scroll the
          way the frames do and shares the coordinate space the measured centres
          are in. */}
      {ridesOwnRing && captures.length > 0 && (
        <motion.div
          aria-hidden
          data-gallery-thumbnail-selection
          className={cn(
            "pointer-events-none absolute z-10",
            isVertical
              ? "right-4 top-0 h-14 w-20 origin-right"
              : `left-0 top-0 ${MOBILE_FRAME_CLASS}`,
          )}
          style={{ transform: ringTransform, willChange: "transform" }}
        >
          <div
            className="absolute inset-0.5 border-2 border-foreground"
            // 8, not the 6 the gap arithmetic suggests: `border-radius`
            // describes a box's outer edge, and this box is a 2px border. The
            // ladder runs outward from the picture, each rung adding the
            // distance travelled — image 4, +2px gap = 6 at the stroke's inner
            // edge, +2px stroke = 8 here, +2px button border = 10 for the focus
            // ring. Written this way CSS resolves the inner corner to 6 on its
            // own, and every arc stays concentric; equal radii at different
            // depths would pinch the gap shut at the corners, which is the thing
            // that reads as wrong.
            style={{ borderRadius: isVertical ? 8 : 5 }}
          />
        </motion.div>
      )}

      {/* The deleted thumbnail, still leaving. See `departing`.

          The box is the frame's own, copied class for class on each surface —
          the same size, the same transparent 2px border, the same padding
          inside it — rather than the single inset those two add up to. Written
          as one inset the picture came out 60×80 instead of 44×68: an
          absolutely positioned <img> keeps its intrinsic size and simply
          ignores insets it cannot satisfy. Same structure, same result, and
          nothing to keep in step by hand.

          No z-index: it sits under the ring and under the frames closing over
          it, which is where a picture on its way out belongs. */}
      {ridesOwnRing && departing && (
        <div
          key={departing.key}
          aria-hidden
          data-gallery-thumbnail-departing
          className={cn(
            "pointer-events-none absolute border-2 border-transparent",
            isVertical
              ? "right-4 top-0 h-14 w-20 origin-right p-1"
              : `left-0 top-0 ${MOBILE_FRAME_CLASS} p-0.5`,
          )}
          style={{
            transform: isVertical
              ? `translate3d(0, ${departing.along}px, 0)`
              : `translate3d(${departing.along}px, ${departing.cross}px, 0)`,
            opacity: departed ? 0 : 1,
            transition: `opacity ${galleryEffects.dismissMs}ms ${galleryEffects.dismissFadeEase}`,
          }}
        >
          {/* relative for the badge, exactly as the frame's own wrapper is. */}
          <div className="relative size-full">
            <img
              src={stillUrl(departing.capture) || "/placeholder.svg"}
              alt=""
              className={cn("block size-full object-cover", isVertical ? "rounded-[4px]" : "rounded-[2px]")}
              draggable={false}
            />
            <CaptureBadge capture={departing.capture} />
          </div>
        </div>
      )}
    </nav>
  )
}

interface GalleryThumbnailFrameProps {
  capture: Capture
  index: number
  label: string
  selected: boolean
  isVertical: boolean
  orientation: "horizontal" | "vertical"
  prefersReducedMotion: boolean
  selectionTransition: Transition
  registerValues: (index: number, values: FrameValues | null) => void
  onSelect: () => void
  onPressFrame: () => void
  onFocusFrame: (index: number, node: HTMLElement) => void
  onBlurFrame: () => void
}

/**
 * One frame.
 *
 * It owns its transform motion value rather than the strip owning an array of
 * them, because the count changes as captures come and go and `useMotionValue`
 * cannot be called a variable number of times. The strip writes through the
 * registry, which costs nothing and keeps the frame a real motion component.
 */
function GalleryThumbnailFrame({
  capture,
  index,
  label,
  selected,
  isVertical,
  orientation,
  prefersReducedMotion,
  selectionTransition,
  registerValues,
  onSelect,
  onPressFrame,
  onFocusFrame,
  onBlurFrame,
}: GalleryThumbnailFrameProps) {
  const transform = useMotionValue(IDENTITY_TRANSFORM)

  // useLayoutEffect, and the phase is what makes a delete's first painted frame
  // right. Children's layout effects run before the strip's, so the registry is
  // already renumbered by the time the strip measures and lays the field out —
  // which is the pass that has to write the collapse offset onto the frames that
  // actually moved. Left in a passive effect, that first pass wrote the new
  // geometry into the old numbering and the strip needed a second, post-paint
  // pass to land it; the gap then closed a frame late, at the head of the spring
  // where the offset shows most.
  useLayoutEffect(() => {
    const values = { transform }
    registerValues(index, values)
    return () => registerValues(index, null)
  }, [index, registerValues, transform])

  // Nothing writes this once the field and the delete are switched off, so a
  // frame that had been transformed would keep its last offset for good.
  useEffect(() => {
    if (!prefersReducedMotion) return
    transform.set(IDENTITY_TRANSFORM)
  }, [prefersReducedMotion, transform])

  const stripDrawsRing = !prefersReducedMotion

  return (
    <motion.button
      // The rail finds its frames by this attribute rather than by a registry
      // they write themselves into; see `readFrames`.
      data-thumbnail-frame=""
      type="button"
      aria-label={label}
      aria-current={selected ? "true" : undefined}
      // p-1 on the rail rather than p-0.5, and that is what buys the gap. The
      // selection ring is drawn 2px inside this box — inside the border, over
      // the padding — so the padding is the only room its 2px stroke has to live
      // in, and at 2px the stroke consumed all of it and sat flush against the
      // picture. 4px is stroke plus the 2px of daylight the radii are drawn for.
      //
      // The button's own box stays 80×56: the rail's pitch, the measured
      // geometry, and the peak-scale fit (80 × 1.34 inside 112px) are all
      // reckoned off it, so the gap is taken out of the picture rather than
      // added to the frame.
      className={cn(
        "group relative shrink-0 cursor-pointer border-2 outline-none",
        "focusKey:border-ring focusKey:ring-2 focusKey:ring-ring/50",
        "border-transparent",
        isVertical
          ? "h-14 w-20 origin-right rounded-[10px] p-1"
          : `${MOBILE_FRAME_CLASS} rounded-[5px] p-0.5`,
      )}
      // will-change on the rail only. Its frames are under a field that moves
      // every one of them on every pointer frame, which is what the hint is for;
      // the strip's move once, on a delete, and `translate3d` is hint enough for
      // that. A phone holding a long stack should not carry a composited layer
      // per thumbnail for a 280ms event.
      style={{ transform, willChange: isVertical ? "transform" : undefined }}
      // The press affordance lives on the inner wrapper below, on both surfaces.
      // It used to sit here as a `whileTap` on the strip, which was safe only
      // while nothing else wrote this element's transform — and now the strip's
      // own delete does, exactly as the rail's magnification always did. Two
      // writers on one transform means whichever landed last wins.
      onPointerDown={isVertical ? onPressFrame : undefined}
      onFocus={isVertical ? (event) => onFocusFrame(index, event.currentTarget) : undefined}
      onBlur={isVertical ? onBlurFrame : undefined}
      onClick={onSelect}
    >
      {/* Both surfaces draw their own ring above; this is what is left for
          reduced motion, which is the one case where nothing writes this
          element's transform at all — no field, no delete — so a shared element
          has nothing to trip over and can stay. */}
      {selected && !stripDrawsRing && (
        <motion.div
          layoutId={`gallery-thumbnail-selection-${orientation}`}
          data-gallery-thumbnail-selection
          className="pointer-events-none absolute inset-0 z-10 border-2 border-foreground"
          // 8, not the 6 the gap arithmetic suggests: `border-radius` describes
          // a box's outer edge, and this box is a 2px border. The ladder runs
          // outward from the picture, each rung adding the distance travelled —
          // image 4, +2px gap = 6 at the stroke's inner edge, +2px stroke = 8
          // here, +2px button border = 10 for the focus ring. Written this way
          // CSS resolves the inner corner to 6 on its own, and every arc stays
          // concentric; equal radii at different depths would pinch the gap
          // shut at the corners, which is the thing that reads as wrong.
          style={{ borderRadius: isVertical ? 8 : 5 }}
          transition={selectionTransition}
        />
      )}
      <div
        className={cn(
          // relative so the badge below has this picture's box to sit in.
          "relative size-full",
          "transition-transform duration-100 ease-out motion-safe:group-active:scale-[0.97]",
        )}
      >
        <img
          src={stillUrl(capture) || "/placeholder.svg"}
          alt=""
          className={cn(
            "block size-full object-cover",
            isVertical ? "rounded-[4px]" : "rounded-[2px]",
          )}
          draggable={false}
        />
        {/* Same mark at the same size on both orientations — the rail used to
            take a duration readout here and no longer does. See CaptureBadge. */}
        <CaptureBadge capture={capture} />
      </div>
    </motion.button>
  )
}
