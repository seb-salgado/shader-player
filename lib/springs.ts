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
 * The two galleries no longer share an entrance, and that is the correction this
 * block exists to record. Both used to: one full screen of horizontal travel,
 * out of the same hook. It is true on touch, where the captures lie side by side
 * in a scroller and the neighbour really is one screen out. It was never true on
 * desktop, which has a vertical rail and a viewer that hard-cuts between
 * captures — so the replacement crossed in from an axis that surface does not
 * have, from off screen, while the very capture it claimed to be was sitting
 * visible in the rail the whole time. See revealScale.
 */
export const galleryEffects = {
  /**
   * How far the deleted capture recedes before it is gone.
   *
   * Not to nothing, and not by a hair either. The 0.97 this used to be is a
   * press affordance, not an exit — at that size the capture only fades, and a
   * fade on its own reads as the picture going dim rather than going away.
   * Pulling back to 0.8 gives it somewhere to go, which is what makes the
   * neighbour arriving read as a replacement rather than a swap.
   */
  dismissScale: 0.8,
  /** Scale and fade on the capture that has already left state. */
  dismissMs: 220,
  /**
   * Ease-out, and the delay below is what makes that safe.
   *
   * The trap captureFlash documents applies to any 1 → 0 fade: an ease-out
   * spends most of the opacity in the first few frames, so the capture is half
   * gone before it has been on screen for two, and what you register is not the
   * picture leaving but the backdrop appearing behind it. This used to answer
   * that with an ease-*in* on both properties, which worked while the exit was
   * only a fade.
   *
   * It stops working once the capture also moves. Ease-in on a transform is
   * dead for its first half — 110ms in, a capture on its way to 0.8 has barely
   * left 0.97 — and dead frames immediately after a press read as latency, not
   * as restraint. So the transform gets the ease-out it wants, and the fade
   * gets the hold it wants from a delay instead of from a curve.
   *
   * Also the desktop reveal's curve, deliberately: the two halves of that delete
   * are one gesture on one axis, and a shared curve is what keeps them from
   * reading as two events that happen to overlap.
   */
  dismissEase: "cubic-bezier(0.23, 1, 0.32, 1)",
  /**
   * How long the capture holds full opacity while it is already shrinking.
   *
   * Four frames at 60Hz, which is all the hold ever needed to be: long enough
   * that the picture is unmistakably the thing that moved first, short enough
   * that it is gone well before the capture replacing it has settled.
   */
  dismissFadeDelayMs: 60,
  /**
   * The neighbour stepping forward into the slot, on desktop.
   *
   * Not a slide, because the desktop viewer is not a strip. It is one slot with
   * a vertical rail of thumbnails beside it, and the wheel steps between
   * captures on a hard cut — nothing ever travels into that slot, so there is no
   * spatial habit for an entrance to be consistent with. What the viewer *is* is
   * a stack: the capture you are looking at, and the rest behind it. Delete the
   * top one and the next is revealed, because it was already there.
   *
   * So the entrance is the only move that is physically true here — the card
   * behind coming forward as the one in front falls back. The exit is already
   * receding on this axis (1 → 0.8); this is the same axis in the other
   * direction, on the same curve. Two properties, two elements, one gesture.
   *
   * 0.98 and not less. The whole distance is a hair, and it has to be: the
   * capture is not entering, it is being uncovered, and anything deeper starts
   * to look like it flew in from behind the screen. No opacity on it either —
   * these captures are near-identical soft gradients, and fading one up over
   * another is how you get mush instead of a replacement.
   */
  revealScale: 0.98,
  /**
   * Shorter than the exit on purpose, and starting on the same frame.
   *
   * The reverse of the reasoning replaceMs gives for the touch gallery. There,
   * the arrival outlasts the exit because it crosses the whole screen and is the
   * thing worth following. Here the arrival is 2% of a scale — it has nothing to
   * say on its own, and its whole job is to be finished and out of the way while
   * the capture you deleted is still visibly leaving.
   */
  revealMs: 200,
  /**
   * The neighbour arriving in the deleted capture's place on *touch* — a full
   * slide, one screen wide, from the side of the strip it actually lives on.
   *
   * Touch only, and it stays a slide: the captures really do lie side by side in
   * a scroller here, so the strip stepping is the one true statement a delete on
   * this surface can make. The desktop viewer has no side for a capture to come
   * from and gets a reveal instead; see revealScale.
   *
   * The number was 300 and the curve was the iOS full-screen push — nearly all
   * the distance in the first half, then a long quiet settle — on the argument
   * that the arrival should outlast the exit so the last thing the eye follows
   * is the picture that stayed. Measuring it killed both halves of that.
   *
   * The exit is a full-screen photograph sitting on top of this one, and it does
   * not begin to fade until dismissFadeDelayMs: sampled on a 375px viewport, the
   * ghost was still at opacity 1.00 at 98ms, by which point the arriving card
   * had already travelled 156 of its 375px behind it. Every frame the old curve
   * spent being expressive was a frame nobody could see. What was visible was
   * the remainder — 23px of travel over the last 150ms — so a delete ended on a
   * drift, and the exit had been finished since 189ms.
   *
   * So: the same 220ms as the exit, and the two halves end together. And an
   * ease-in-out rather than an ease-out, which is the documented curve for
   * something moving across the screen rather than entering it — this card is a
   * strip stepping, not an element appearing. Its slow start is not a cost here,
   * because the slow start is the part behind the ghost, and the responsiveness
   * an ease-out would have bought is already paid for by the exit, which begins
   * moving on the press frame. Half the distance is still unspent at 110ms,
   * which is where the ghost finally lets go of it.
   */
  replaceMs: 220,
  replaceEase: "cubic-bezier(0.77, 0, 0.175, 1)",
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
 * `transform-origin: top center`, so the top edge never moves and the gutters
 * open symmetrically.
 */
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
  tallTopPx: 32,

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
   * restraint — the same argument galleryEffects.dismissEase makes above, for
   * the same reason.
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
   * Enter: you press, the bar clears, the viewfinder pulls back, the controls
   * arrive. The bar's own departure is not here — it is the `hide()` helper in
   * MobileNav, which shares this curve but keeps its own, shorter durations.
   *
   * The panel is held back until the canvas has covered most of its distance.
   * On this curve that is about 85% at 170ms, so the room exists before anything
   * is put in it.
   *
   * The whole thing reads as roughly 290ms, which is the point of the numbers
   * rather than a consequence of them: it sits between the 320ms the panel takes
   * to settle when it is *dragged* and the 450ms of the fullscreen gallery
   * morph. That is the band a half-screen composition change belongs in. It used
   * to read as 175ms, which is where the dropdowns live.
   */
  enter: {
    canvasMs: 360,
    panelMs: 220,
    panelDelayMs: 170,
  },

  /**
   * Exit: the mirror, and about 17% quicker — the same relationship the sheet
   * this replaced had between its 250ms in and 200ms out.
   *
   * Order is reversed, and that ordering is the mechanism rather than a flourish:
   * the panel is opaque and sits above the canvas, so it has to be most of the
   * way gone before the canvas grows back into its space. 140ms on this curve is
   * 90% gone by 76ms, which is what the canvas's 50ms delay is buying.
   */
  exit: {
    panelMs: 140,
    canvasMs: 300,
    canvasDelayMs: 50,
    /**
     * How long the bar waits before coming back. The bar is the destination, so
     * it arrives last: at 120ms it starts once the panel has cleared and lands a
     * hair behind the canvas. More practically, fading it up underneath a panel
     * that is still fading down is two crossfading planes in the same place.
     */
    barDelayMs: 120,
  },

  /**
   * How far the panel travels on the way in, in px. Eight, and no more.
   *
   * The canvas is the only thing in this transition that really moves; the panel
   * materialises in the room the canvas left. A panel sliding up while the
   * canvas shrinks down is two elements converging on one axis — and it would
   * re-import the very sheet vocabulary this change exists to remove.
   */
  panelTravelPx: 8,
} as const;
