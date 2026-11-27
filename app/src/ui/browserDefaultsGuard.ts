/**
 * hive runs inside WebView2, which still carries browser features a desktop app must not show:
 * the page context menu (Back / Refresh / Save as / Print / More tools), the Find bar (Ctrl+F, F3),
 * Print, Reload (which drops the open board) and "Save page as". hive's own handlers claim most
 * right-clicks and keys, but anything they leave unhandled (a right-click on a spot no layer owns,
 * Ctrl+F while a note's text has focus and commands are paused) fell through to the browser.
 *
 * The guard decides LAST, after every hive handler of the same event: whatever hive did with the
 * event stays as it was, and only the browser's own default is cancelled.
 */

interface ShortcutLike {
  code: string;
  ctrlKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
  metaKey: boolean;
}

/** Ctrl/⌘ + these: Find, Find next/previous, Print, Reload, Save page as, View source. */
const BROWSER_CTRL_CODES = new Set(["KeyF", "KeyG", "KeyP", "KeyR", "KeyS", "KeyU"]);
/** Alone or with Shift/Ctrl: F3 = Find next/previous, F5 = Reload. */
const BROWSER_FUNCTION_CODES = new Set(["F3", "F5"]);

/** A key that opens a WebView2 browser feature when nobody cancels it. */
export function isBrowserShortcut(event: ShortcutLike): boolean {
  // Ctrl+Alt is AltGr on Windows layouts: it types characters, never a browser shortcut.
  if (event.altKey) return false;
  if (BROWSER_FUNCTION_CODES.has(event.code)) return true;
  return (event.ctrlKey || event.metaKey) && BROWSER_CTRL_CODES.has(event.code);
}

const TEXT_INPUT_TYPES = new Set([
  "date",
  "datetime-local",
  "email",
  "month",
  "number",
  "password",
  "search",
  "tel",
  "text",
  "time",
  "url",
  "week",
]);

interface ElementLike {
  tagName?: string;
  type?: string;
  isContentEditable?: boolean;
  parentElement?: ElementLike | null;
}

/**
 * Text fields keep the native edit menu (Cut / Copy / Paste / spelling) when no hive menu claimed
 * the right-click; everywhere else the browser's page menu is never wanted.
 */
export function allowsNativeContextMenu(target: unknown): boolean {
  let current = target !== null && typeof target === "object" ? (target as ElementLike) : null;
  while (current) {
    const tagName = (current.tagName ?? "").toUpperCase();
    if (tagName === "TEXTAREA") return true;
    if (tagName === "INPUT") return TEXT_INPUT_TYPES.has((current.type || "text").toLowerCase());
    if (current.isContentEditable === true) return true;
    current = current.parentElement ?? null;
  }
  return false;
}

/**
 * Runs `decide` after every other listener of this very event on `view`, whatever order they were
 * registered in: a window listener added during the capture phase is invoked at the end of the
 * window's bubble phase. If a handler stops propagation the late listener never runs and is
 * removed after the dispatch, so it can never fire for a later event.
 */
function afterOtherHandlers(view: Window, event: Event, decide: () => void): void {
  const late = (current: Event): void => {
    if (current === event) decide();
  };
  view.addEventListener(event.type, late);
  view.setTimeout(() => view.removeEventListener(event.type, late), 0);
}

function cancelIfUnhandled(event: Event): void {
  if (!event.defaultPrevented) event.preventDefault();
}

/** Installs the guard on a hive window; returns the uninstall function. */
export function installBrowserDefaultsGuard(view: Window): () => void {
  function onKeyDown(event: KeyboardEvent): void {
    if (!isBrowserShortcut(event)) return;
    afterOtherHandlers(view, event, () => cancelIfUnhandled(event));
  }

  function onContextMenu(event: MouseEvent): void {
    if (allowsNativeContextMenu(event.target)) return;
    afterOtherHandlers(view, event, () => cancelIfUnhandled(event));
  }

  view.addEventListener("keydown", onKeyDown, true);
  view.addEventListener("contextmenu", onContextMenu, true);
  return () => {
    view.removeEventListener("keydown", onKeyDown, true);
    view.removeEventListener("contextmenu", onContextMenu, true);
  };
}

if (typeof window !== "undefined") {
  installBrowserDefaultsGuard(window);
}
