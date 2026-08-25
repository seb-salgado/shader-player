export const SIDEBAR_MIN_WIDTH = 275;
export const SIDEBAR_MAX_WIDTH = 400;
export const DEFAULT_SIDEBAR_WIDTH = 315;
export const SIDEBAR_WIDTH_STORAGE_KEY = "shader-player:sidebar-width";

export function clampSidebarWidth(width: number): number {
  return Math.min(Math.max(width, SIDEBAR_MIN_WIDTH), SIDEBAR_MAX_WIDTH);
}

/**
 * Applies the stored width before the browser's first paint.
 *
 * A layout effect is too late here. It runs before the *hydrated* render
 * paints, but the browser has already painted the server's HTML by then — so a
 * width that only React knows about arrives one paint after the sidebar is
 * first on screen, and the panel visibly jumps from the default to the stored
 * value. Only a blocking script in the document can beat that paint.
 *
 * Written against `document.documentElement` rather than the page root, which
 * does not exist yet when this runs. `--sidebar-width` inherits from there, and
 * nothing renders the variable into the markup, so this stays the single
 * writer until the hook takes over.
 *
 * `v === v` is a NaN check: `parseFloat` returns NaN for a missing or junk
 * entry, and NaN is the only value not equal to itself.
 */
export const SIDEBAR_WIDTH_BOOT_SCRIPT = `try{var v=parseFloat(localStorage.getItem(${JSON.stringify(
  SIDEBAR_WIDTH_STORAGE_KEY
)}));if(v===v){v=Math.min(Math.max(v,${SIDEBAR_MIN_WIDTH}),${SIDEBAR_MAX_WIDTH});document.documentElement.style.setProperty("--sidebar-width",v+"px")}}catch(e){}`;
