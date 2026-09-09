export const SURFACE_BG: Record<number, string> = {
  1: "bg-surface-1",
  2: "bg-surface-2",
  3: "bg-surface-3",
  4: "bg-surface-4",
  5: "bg-surface-5",
  6: "bg-surface-6",
  7: "bg-surface-7",
  8: "bg-surface-8",
};

export const SURFACE_SHADOW: Record<number, string> = {
  1: "shadow-surface-1",
  2: "shadow-surface-2",
  3: "shadow-surface-3",
  4: "shadow-surface-4",
  5: "shadow-surface-5",
  6: "shadow-surface-6",
  7: "shadow-surface-7",
  8: "shadow-surface-8",
};

/**
 * Fill + shadow for the selected cell of a segmented control — the thumb that
 * sits proud of a recessed track. Shared by the shader tabs and the appearance
 * toggle so the two can't drift apart.
 *
 * Four steps above the substrate, not one, because the thing to clear is the
 * track, not the bar. The track is a 6% white wash over the substrate, which in
 * dark mode lifts it further than a single surface step does — at +1 the
 * "raised" cell came out *darker* than the recess around it, and the only thing
 * still reading as a thumb was the ring. Fill first, outline second.
 *
 * Fill only — none of SURFACE_SHADOW's levels work here, because every one of
 * them carries a `0 0 0 1px` ring, and a ring on a cell that butts its
 * neighbours reads as a border drawn around the selection rather than as the
 * selection sitting proud of the track. What lifts a thumb out of a recess is
 * the contact shadow under it, so keep that layer and drop the ring.
 *
 * Two drop layers, not one. Strength follows the surface ladder's own
 * progression — `0 3px 3px -1.5px` is exactly the layer separating --shadow-2
 * from --shadow-3 — rather than a heavier alpha, so the cell stays on the same
 * shadow system as everything else. Both spreads stay negative, which keeps the
 * shadow tucked under the cell: a thumb resting on the track, not floating.
 *
 * The top bevel is the third layer: on a dark track the fill alone is a small
 * step, and the inset highlight is what says "top edge" without outlining the
 * shape. It used to be a `dark:` override on top of a lighter, bevel-less pair
 * for light mode; with the app dark-only that pair was unreachable, so this is
 * the dark one promoted to the base.
 */
export function raisedThumb(substrate: number): string {
  const level = Math.min(8, Math.round(Math.max(1, substrate) + 4));
  return [
    SURFACE_BG[level],
    "shadow-[inset_0_1px_0_0_var(--dm-hi-mid),0_1px_1px_-0.5px_var(--dm-drop),0_3px_3px_-1.5px_var(--dm-drop)]",
  ].join(" ");
}

export function surfaceClasses(bgLevel: number, shadowLevel: number = bgLevel): string {
  // Round after clamping so a fractional level can't index out of the lookup
  // tables (which would render "undefined undefined").
  const bg = Math.round(Math.max(1, Math.min(8, bgLevel)));
  const shadow = Math.round(Math.max(1, Math.min(8, shadowLevel)));
  return `${SURFACE_BG[bg]} ${SURFACE_SHADOW[shadow]}`;
}
