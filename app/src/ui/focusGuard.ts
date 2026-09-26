const POINTER_FOCUSABLE_SELECTOR = [
  "button",
  "a[href]",
  "summary",
  "[role='button']",
  "[role='checkbox']",
  "[role='radio']",
  "[role='switch']",
  "[role='tab']",
  "[role^='menuitem']",
  "[role='option']",
  "[tabindex]:not([tabindex='-1'])",
  "[data-resize-handle]",
  "[data-group-scale-handle]",
  "[data-zone-resize-handle]",
].join(",");

const TEXT_ENTRY_SELECTOR = [
  "input",
  "textarea",
  "select",
  "[contenteditable]:not([contenteditable='false'])",
  ".cm-editor",
  ".cm-content",
  "[data-text-editable]",
].join(",");

const DISABLED_SELECTOR = ":disabled, [aria-disabled='true']";

/** Whether a pointer-focused control should lose focus after activation. */
export function shouldBlurPointerFocus(target: Element | null): boolean {
  if (!target) return false;
  if (target.closest(TEXT_ENTRY_SELECTOR)) return false;
  const focusTarget = target.closest(POINTER_FOCUSABLE_SELECTOR);
  return Boolean(
    focusTarget &&
      !focusTarget.closest(TEXT_ENTRY_SELECTOR) &&
      !focusTarget.matches(DISABLED_SELECTOR),
  );
}

/** Blurs an eligible control and reports whether it could be blurred. */
export function blurPointerFocusTarget(target: Element | null): boolean {
  if (!target || !shouldBlurPointerFocus(target)) return false;
  const focusTarget = target.closest(POINTER_FOCUSABLE_SELECTOR) as (Element & { blur?: () => void }) | null;
  if (!focusTarget || typeof focusTarget.blur !== "function") return false;
  focusTarget.blur();
  return true;
}

/**
 * Keeps pointer-originated focus from lingering on controls and becoming
 * :focus-visible when a later keyboard command is pressed. Keyboard focus is
 * untouched, and text entry controls keep their normal focus behavior.
 */
export function installPointerFocusGuard(root: Document): () => void {
  const view = root.defaultView;
  let pointerId: number | null = null;
  let pointerFocusTarget: Element | null = null;
  let resetTimer: number | null = null;

  function clearPointerState(): void {
    pointerId = null;
    pointerFocusTarget = null;
    if (resetTimer !== null) {
      view?.clearTimeout(resetTimer);
      resetTimer = null;
    }
  }

  function onPointerDown(event: PointerEvent): void {
    if (event.isPrimary === false) return;
    if (resetTimer !== null) {
      view?.clearTimeout(resetTimer);
      resetTimer = null;
    }
    pointerId = event.pointerId;
    const target = event.target instanceof Element ? event.target : null;
    pointerFocusTarget = target && shouldBlurPointerFocus(target)
      ? target.closest(POINTER_FOCUSABLE_SELECTOR)
      : null;
    blurPointerFocusTarget(root.activeElement);
  }

  function onFocusIn(event: FocusEvent): void {
    if (pointerId === null || !(event.target instanceof Element)) return;
    if (event.target.closest(POINTER_FOCUSABLE_SELECTOR) === pointerFocusTarget && pointerFocusTarget) {
      blurPointerFocusTarget(event.target);
    }
  }

  function onPointerEnd(event: PointerEvent): void {
    if (pointerId !== event.pointerId) return;
    const activeElement = root.activeElement;
    if (pointerFocusTarget && activeElement?.closest(POINTER_FOCUSABLE_SELECTOR) === pointerFocusTarget) {
      blurPointerFocusTarget(activeElement);
    }
    if (view) {
      resetTimer = view.setTimeout(clearPointerState, 0);
    } else {
      clearPointerState();
    }
  }

  root.addEventListener("pointerdown", onPointerDown, true);
  root.addEventListener("focusin", onFocusIn, true);
  root.addEventListener("pointerup", onPointerEnd, true);
  root.addEventListener("pointercancel", onPointerEnd, true);
  view?.addEventListener("blur", clearPointerState);

  return () => {
    root.removeEventListener("pointerdown", onPointerDown, true);
    root.removeEventListener("focusin", onFocusIn, true);
    root.removeEventListener("pointerup", onPointerEnd, true);
    root.removeEventListener("pointercancel", onPointerEnd, true);
    view?.removeEventListener("blur", clearPointerState);
    clearPointerState();
  };
}

if (typeof document !== "undefined") {
  installPointerFocusGuard(document);
}
