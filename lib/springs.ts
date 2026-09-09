/**
 * The curve for anything that settles rather than snaps.
 *
 * The house ease-out elsewhere in this app is cubic-bezier(0.23, 1, 0.32, 1) — a
 * quint, which covers 90% of its travel in the first 36% of its time. That is
 * right for a 125ms colour change or a 150ms fade, where the whole animation is
 * shorter than the eye's own settling time and the only job is to be over.
 *
 * It is wrong for anything with mass. Spend 280ms on that curve and 180ms of it
 * is drift nobody can see: what reads is a hard cut followed by a crawl. This one
 * is a cubic — 90% at 54% of the duration — so the time is spent on visible
 * movement instead. It still starts immediately, 27% of the travel inside the
 * first tenth of the time, so there are no dead frames after a press.
 *
 * It is also the closest bezier to a bounce-0 spring, which matters here rather
 * than in the abstract: the controls panel already settles on one when it is
 * dragged (controlsSplit.detentSpring). Tapping the button to summon that same
 * panel now moves it the same way, instead of giving one object two
 * personalities depending on how it was asked.
 */
export const settleEase = "cubic-bezier(0.33, 1, 0.68, 1)";

export const spring = {
  fast: {
    type: "spring" as const,
    duration: 0.08,
    bounce: 0,
    exit: { duration: 0.06 },
  },
  // Critically damped: same perceived speed as a bouncier tier, but lands
  // exactly with no overshoot — for short travel and panels/sheets that must
  // settle precisely (dropdowns, tabs, drawers, merged selection backgrounds).
  moderate: {
    type: "spring" as const,
    duration: 0.16,
    bounce: 0,
    exit: { duration: 0.12 },
  },
  slow: {
    type: "spring" as const,
    duration: 0.24,
    bounce: 0.12,
    exit: { duration: 0.16 },
  },
} as const;

/**
 * The shutter flash over the viewfinder: rise, *hold*, release.
 *
 * The hold is the whole thing. An earlier version peaked for a single instant
 * and decayed on an ease-out — which, applied to 1→0, dumps half the brightness
 * in the first 10ms and then lingers dim. At 60Hz that never rendered a single
 * full-opacity frame: it read as a flicker with a smear, not a flash. Holding
 * full for ~3 frames and releasing on an ease-in inverts both mistakes.
 *
 * The colours mirror --background in app/globals.css rather than resolving it,
 * because the flash renders inside the canvas wrapper — which is pinned `dark`
 * at every width — but has to answer to the *page* theme instead. Keep them in
 * step with the two --background declarations.
 */
export const captureFlash = {
  durationMs: 190,
  /** Full opacity by here. */
  riseMs: 35,
  /**
   * Held at full until here, then released for the remainder.
   *
   * Also what the toolbar waits for: the slot and the thumbnail are held back
   * until the black starts lifting, so the shutter reads as one event finishing
   * before the next begins rather than everything moving at once.
   */
  holdEndMs: 85,
  light: "oklch(1 0 0)",
  dark: "oklch(0.145 0 0)",
} as const;

/**
 * The thumbnail ↔ fullscreen gallery morph.
 *
 * Also outside the tiers above, and for the same reason as captureFlight: it
 * crosses the whole screen. Shared by both ends of the shared-element pair so
 * opening and closing are mirror images — whichever element Framer happens to
 * be driving, the curve is the same.
 */
export const galleryMorph = {
  type: "spring" as const,
  duration: 0.45,
  bounce: 0.08,
} as const;

/**
 * The deleted capture leaving, and the one that takes its place arriving.
 *
 * Both gallery actions used to be gated behind an animation: the download did
 * not download for 1200ms and the delete did not delete for 1500ms, because the
 * real action was wired to a WebGL effect's completion callback. The action now
 * fires on the press, which is the fix that mattered; what is left here is only
 * how the outgoing frame gets off screen and the next one gets on.
 *
 * Deliberately not an *effect*. The shutter flash is ceremony because taking the
 * picture is the point of the app; deleting a bad frame is housekeeping, and
 * ceremony on housekeeping is what you notice on the two-hundredth time. The
 * canvas is where this project gets to be excessive. The gallery is a tool. Two
 * richer versions were built and cut — a fire burn and a particle dispersal —
 * and neither failed on timing: a dispersal needs edges to read as fragments,
 * and these captures are soft gradients with none, so it came apart into static
 * rather than into pieces.
 *
 * The two galleries share an entrance again, and the axis is the whole of what
 * separates them.
 *
 * They shared one before, and that one was wrong: a full screen of *horizontal*
 * travel on both surfaces. True on touch, where the captures lie side by side in
 * a scroller and the neighbour really is one screen out; never true on desktop,
 * where the rail is vertical and the replacement crossed in from an axis that
 * surface does not have. The correction that followed cut the desktop travel to
 * 28px on the right axis — and bought the direction at the price of the motion.
 * A step that small has to wait out the exit to be seen at all, so a delete read
 * as a picture dissolving and then, separately, a nudge: two beats, and the
 * second one small enough to miss.
 *
 * So: one slide, one curve, read against each surface's own axis — across on
 * touch, down the rail on desktop. Only the duration differs; see replaceYMs.
 */
export const galleryEffects = {
  /** The fade on the capture that has already left state. */
  dismissMs: 220,
  /**
   * Ease-*in*, which is where this started and where it has come back to.
   *
   * The exit was once a fade and nothing else, and an ease-in is what a bare
   * 1 → 0 fade wants. The trap captureFlash documents: an ease-out spends most
   * of the opacity in the first few frames, so the capture is half gone before
   * it has been on screen for two, and what you register is not the picture
   * leaving but the backdrop appearing behind it.
   *
   * Then the capture also began to recede, 1 → 0.8, and an ease-in on a
   * transform is dead for its first half — dead frames immediately after a press
   * read as latency, not as restraint. So the pair moved to an ease-out, and the
   * fade got the hold it needed from a 60ms delay instead of from a curve.
   *
   * The recede is gone again — Seb's call, after a stretch where a hot-reload
   * bug meant it had not been drawing at all and nothing about the delete felt
   * missing for it. With nothing moving, neither the ease-out nor the delay has
   * a reason left, and the first answer is the right one again. The slow start
   * *is* the hold.
   */
  dismissFadeEase: "cubic-bezier(0.4, 0, 1, 1)",
  /**
   * The neighbour arriving in the deleted capture's place on *touch* — a full
   * slide, one screen wide, from the side of the strip it actually lives on.
   *
   * The number was 300 and the curve was the iOS full-screen push — nearly all
   * the distance in the first half, then a long quiet settle — on the argument
   * that the arrival should outlast the exit so the last thing the eye follows
   * is the picture that stayed. Measuring it killed both halves of that.
   *
   * The exit is a full-screen photograph sitting on top of this one, and it is
   * in no hurry to leave: sampled on a 375px viewport, back when the fade was
   * held for four frames before it began, the ghost was still at opacity 1.00 at
   * 98ms — by which point the arriving card had already travelled 156 of its
   * 375px behind it. The ease-in it fades on now holds nearly as long without
   * being asked to. Every frame the old curve spent being expressive was a frame
   * nobody could see. What was visible was the remainder — 23px of travel over
   * the last 150ms — so a delete ended on a drift, and the exit had been
   * finished since 189ms.
   *
   * So: the same 220ms as the exit, and the two halves end together.
   */
  replaceXMs: 220,
  /**
   * The same slide on desktop, down the rail's axis instead of across the strip.
   *
   * Longer, because the slot is: the viewer is the window less 32px of inset, so
   * the arrival crosses something like 850px where the phone crosses 375. Held
   * at 220ms that is four thousand pixels a second, which stops reading as a
   * picture sliding and starts reading as a cut with a smear on it.
   *
   * 340ms is 220 × √2.4 — duration scaled by the *root* of the distance rather
   * than by the distance. Matching the phone's pixels-per-second outright would
   * be 500ms+, and it would feel slower than the phone rather than the same:
   * a longer travel is read as one movement, not as a proportionally longer one,
   * so the eye wants somewhat more time and nothing like linearly more. It is
   * over the 300ms UI ceiling on purpose — this is drawer-sized travel, and the
   * drawer band is where it belongs.
   *
   * The consequence worth knowing: the exit finishes at 220 and the arrival runs
   * on to 340, so the last 120ms of a desktop delete is the capture that stayed,
   * alone and still settling. That is the right thing for the eye to end on, and
   * it is the one place these two surfaces genuinely differ in shape rather than
   * in axis.
   *
   * No opacity on it, on either surface: these captures are near-identical soft
   * gradients, and fading one up over another is how you get mush instead of a
   * replacement. The arriving picture is opaque for the whole crossing.
   */
  replaceYMs: 340,
  /**
   * Touch: an ease-in-*out* rather than the ease-out an arrival would normally
   * take — because this is not an element appearing, it is a strip stepping, and
   * that is the documented curve for something crossing the screen. Its slow
   * start is free here: the first third of the crossing happens under a
   * full-screen ghost that began fading on the press frame, so the
   * responsiveness an ease-out would have bought is already paid for.
   */
  replaceXEase: "cubic-bezier(0.77, 0, 0.175, 1)",
  /**
   * Desktop: the house ease-out, and the axis is not why they differ — the kind
   * of movement is.
   *
   * The touch card is a strip stepping, because that strip is a scroller the
   * user drags by hand. The desktop slot is not: the wheel hard-cuts between
   * captures and nothing has ever travelled it. So what happens here is an
   * element *entering* an empty slot, which takes an ease-out on any reading.
   *
   * It is also what the rest of the app uses — see the note at the top of this
   * file. Sharing the in-out across both surfaces made this the only ease-in-out
   * in the project, bought with a curve the surface did not want.
   *
   * The measured payoff is not the peak velocity, which barely moves — 12,400
   * px/s to 10,900. It is *where* the speed sits. The in-out put 550 of the
   * 853px into the 80ms either side of the midpoint, so the capture made its
   * big move in the open, after the ghost had gone: at 140ms it was 24% home
   * where the phone's is 88%, and a delete read as dissolve-then-arrive.
   *
   * The ease-out spends its peak in the first frames instead — under a ghost
   * still at 0.88 opacity, where nothing can be smeared because nothing can be
   * seen — and is 93% home by 140ms. Which is the phone's number, and the part
   * of that timing the vertical version was actually missing. The two halves
   * overlap again; only the axis and the settle differ.
   */
  replaceYEase: "cubic-bezier(0.23, 1, 0.32, 1)",
  /**
   * How long the backdrop lingers after the *last* capture has dissolved.
   *
   * Only ever used for that one case, and it exists because the gallery cannot
   * cover it itself: emptying the list makes the viewer render null on the same
   * commit, so its own backdrop is gone a frame before the exit begins and the
   * capture would be dissolving against the live shader. Held opaque for the
   * length of the exit and dropped afterwards, the order reads properly — the
   * picture goes, and only then does the canvas come back.
   */
  dismissBackdropMs: 220,
} as const;

// Fallback delay (ms) for deferred-unmount timers that guard an exit tween:
// popups keep their portal mounted until onAnimationComplete fires, but a
// throttled/background tab can stall the animation, so a timer force-unmounts
// after the tier's exit duration plus a safety buffer. Deriving it here keeps
// the timers in step with the tokens above.
export const exitFallbackMs = (tier: { exit: { duration: number } }) =>
  Math.round(tier.exit.duration * 1000) + 100;

/**
 * Mobile only: the viewfinder stepping back to make room for the controls.
 *
 * This replaced a bottom sheet, and the replacement is the whole point. A sheet
 * slides *over* the canvas, which is the one thing you are looking at while you
 * drag a slider. Here nothing slides over anything: the canvas scales down from
 * its top edge, and the controls occupy the room it vacates.
 *
 * **Scale, not layout.** Three reasons, and all three are load-bearing:
 *
 * 1. Aspect ratio. A height change re-renders the shader into a shorter
 *    full-width box; a uniform scale gives a smaller copy of the same picture,
 *    with black gutters either side. The second is what the design asks for —
 *    the artwork is not reframed, it is set back.
 * 2. The compositor. `height` is layout + paint + composite on the main thread,
 *    against a WebGL loop that is already drawing every frame.
 * 3. No buffer churn. ShaderCanvas observes its <canvas> with a ResizeObserver
 *    that reallocates and *wipes* the drawing buffer on every callback. RO
 *    reports the layout box, which a transform does not touch — so it stays
 *    silent for the whole transition. A height animation would have wiped and
 *    redrawn the buffer once per frame.
 *
 *    Silent observation was only ever half of that, and for a while it was the
 *    half that was true: the callback measured `getBoundingClientRect()`, which
 *    *is* the transformed box, so anything else that called it mid-scale sized
 *    the buffer to the shrinking picture. See the note on `resize` in
 *    ShaderCanvas for what that cost — the hairline along this edge among it.
 *
 * `transform-origin: top center`, so the top edge never moves and the gutters
 * open symmetrically.
 */
/**
 * The margin left above the panel at the lifted detent. Hoisted out of the token
 * below because the travel expression has to reference it, and an object literal
 * cannot read its own keys.
 */
const SHEET_TOP_PX = 32;

export const controlsSplit = {
  /**
   * The share of the viewport the viewfinder keeps while the controls are open.
   *
   * One number for both halves: the panel's top is 50dvh in CSS, and the canvas
   * scale is (rootHeight × this) ÷ the canvas box's own layout height. The page
   * root is exactly 100dvh tall, so the two agree by construction and the
   * canvas's bottom edge lands on the panel's top edge with no seam to tune.
   *
   * A fraction rather than a fixed panel height, so a short phone and a tall one
   * both get a viewfinder in proportion to their screen rather than one of them
   * getting a stamp. In practice the scale lands between 0.61 and 0.65 across
   * every phone size, which is the range the design was drawn at.
   */
  openFraction: 0.5,

  /**
   * Where the panel's top edge sits at the *lifted* detent — and the one number
   * above that is not the canvas's business.
   *
   * The split is where the panel rests and what the canvas is measured against;
   * `openFraction` remains that measurement's only input. This is a second
   * position the panel can be *asked* for, by grabbing it, and the canvas does
   * not answer: it has already stepped back, and a viewfinder that shrank again
   * every time the workbench grew would be two elements moving on one axis for
   * one gesture.
   *
   * Pixels, not a fraction, and it is the only measurement here that is. Every
   * other number in this token is a share of the viewport because it divides the
   * screen between two things that both need room in proportion. This one
   * divides nothing: it is the margin left above a panel that has taken the
   * screen, and a margin is a constant on a small phone and a large one alike. A
   * fraction would have made it 78px on an SE and 111px on a Pro Max, which is
   * not a tighter or looser version of the same design — it is the strip growing
   * into a second thing on screen.
   *
   * Thirty-two, not zero. What is left is a sliver of live artwork rather than a
   * viewfinder, and that is the point: it says the canvas is still there and
   * still running, and it keeps the tap-outside-to-dismiss target that the whole
   * composition rests on. It is under the 44px a primary target would need, but
   * this is not one — the X and Escape both close from here too.
   */
  tallTopPx: SHEET_TOP_PX,

  /**
   * The settle after the finger lets go.
   *
   * Its own tier rather than spring.moderate, and the reason is the handoff:
   * this animation starts with whatever velocity the flick had. 0.16s cannot
   * absorb that — a fast release lands past the detent it was aiming at and has
   * to come back, which is the one thing a detent must never do. 0.32s takes the
   * velocity as an initial condition and still arrives inside a third of a
   * second.
   *
   * A hair of bounce, unlike the tiers above, because this ends against nothing:
   * both detents have room on the far side (the panel runs off screen below, and
   * the canvas is above), so a few pixels of overshoot is weight rather than an
   * element hitting a wall it cannot pass.
   */
  detentSpring: {
    type: "spring" as const,
    duration: 0.32,
    bounce: 0.05,
  },

  /**
   * Air between the viewfinder's bottom edge and the panel's top edge.
   *
   * Taken out of the canvas, not out of the panel: the panel's height is what
   * the parameters have to live in, and it is already the tighter of the two on
   * a short phone. The canvas gives up 8px of an already-scaled box, which costs
   * it about a hundredth of a point of scale.
   *
   * The two surfaces are the same colour, so this is not a seam anyone can point
   * at — it is the difference between the artwork *ending* and the artwork being
   * cropped by the thing below it.
   */
  canvasGapPx: 8,

  /**
   * An ease-out, and it stays one even though this is an element *moving on
   * screen* rather than entering — which normally argues for an ease-in-out.
   *
   * The move is the response to the press. An ease-in-out is dead for its first
   * third, and dead frames immediately after a press read as latency, not as
   * restraint.
   *
   * What changed is *which* ease-out. This used to be the house quint, and on a
   * quint the 280ms it ran at was visually finished at 101ms: the canvas snapped
   * back, then drifted the last tenth of the way for another 180ms. Half the
   * screen changing composition at dropdown speed, with a crawl on the end of
   * it. See settleEase for the trade, and detentSpring for what it now matches.
   *
   * No spring, and no bounce. The return leg ends at scale(1), which is the
   * canvas at full size against the viewport edges and the control bar: an
   * overshoot has nowhere to go but off screen and underneath the bar. Bouncing
   * only on the way in would be worse — one gesture, two personalities.
   */
  ease: settleEase,

  /**
   * Enter: you press, the bar clears, and the screen splits — the viewfinder
   * stepping back and the sheet rising to meet it.
   *
   * **One duration for both halves, and that is the whole design of this
   * token.** The panel used to be held back 170ms and then materialise in the
   * room the canvas had left, because it only travelled 8px: with nothing to
   * follow, arriving early would have read as a layer appearing over a canvas
   * still in motion. A sheet that actually travels does not have that problem —
   * it has the opposite one. Two elements moving on one axis are only ever one
   * gesture if they share a curve *and* a duration, so they are written as a
   * single number rather than as two that have to be kept in step.
   *
   * They are not converging, which is what makes this legal. The canvas scales
   * from `transform-origin: top center`, so its bottom edge travels *up*; the
   * sheet's top edge travels up behind it. Same direction, same curve, same
   * duration, landing canvasGapPx apart on one line. The screen splits open in
   * one move instead of in two beats.
   *
   * 360ms for about 50dvh of sheet travel — roughly 400px on a phone, which is
   * the band Vaul and the iOS sheets sit in, and the same number the canvas was
   * already tuned to.
   *
   * The bar's departure is not here. It is the `hide()` helper in MobileNav,
   * which shares this curve but keeps its own, shorter durations: those controls
   * are 44 and 48px and this is half the screen.
   */
  enter: {
    durationMs: 360,
  },

  /**
   * Exit: the mirror, and about 17% quicker — the same relationship the sheet
   * this replaced had between its 250ms in and 200ms out.
   *
   * No ordering left to arrange, and that is what the slide bought. While the
   * panel was a fade, it was an opaque plane sitting over the canvas: it had to
   * be most of the way gone before the canvas could grow back through it, which
   * is what the 50ms canvas delay was for. A sheet leaves the frame instead of
   * dissolving in place, and it leaves *downward* — the same direction the
   * canvas's bottom edge is travelling as it grows. Nothing is uncovered that
   * was not already the canvas's own space, so the two start on the same frame.
   */
  exit: {
    durationMs: 300,
    /**
     * How long the bar waits before coming back.
     *
     * The bar is the destination, so it arrives last — but the reason is no
     * longer that fading it up under a fading panel would be two crossfading
     * planes. It is occlusion: the sheet slides down *over* the bar on its way
     * out. 120ms is where the descending edge has just cleared the shutter, so
     * the controls fade up into space that is already theirs.
     */
    barDelayMs: 120,
  },

  /**
   * How far the panel travels: from wherever it is resting to fully off screen.
   *
   * Eight pixels and a fade, once, on the argument that the canvas is the only
   * thing that really moves and the panel merely materialises in the room it
   * left — a slide would re-import the sheet vocabulary the split existed to
   * remove. The argument was about *sliding over* the canvas, and it survives:
   * this sheet still never covers the viewfinder on its way in. What it does not
   * survive is the reading. A half-screen opaque plane that fades has no
   * direction, so nothing said where it came from or where the drag could take
   * it — and the panel is draggable, which is a fact a fade actively hides.
   *
   * Written as the distance to the viewport's bottom edge rather than as a
   * constant, which is what makes one expression serve every case. The sheet's
   * box is pinned at `top: tallTopPx`, so its top edge sits at
   * `tallTopPx + --sheet-y`, and the run to off screen is whatever is left of
   * 100dvh. Substituted at the start of each animation, so the *exit* is correct
   * from the lifted detent and from the split without either one being special
   * cased — and the enter, which always opens at the split, resolves to exactly
   * openFraction.
   *
   * It reads `--sheet-y`, which is why that property is declared on the panel's
   * fixed frame rather than on the sheet it positions. Same subtree, same style
   * recalc either way; see ControlsPanel.
   */
  panelTravel: `calc(100dvh - ${SHEET_TOP_PX}px - var(--sheet-y))`,
} as const;
