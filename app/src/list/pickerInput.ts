import type { Action } from "svelte/action";

/** Keep the search input focused until a pointer-activated picker button has clicked.
 * The global pointer focus guard otherwise blurs that button during focusin, causing
 * a null-relatedTarget focusout before click can add the selected row.
 * Keyboard focus navigation and native text selection remain available.
 */
export const listPickerInput: Action<HTMLElement, () => void> = (element, close) => {
  const onPointerDown = (event: PointerEvent) => {
    if (event.button !== 0) return;
    const target = event.target instanceof Element ? event.target : null;
    if (target?.closest("input, textarea, select, [contenteditable]")) return;
    // Only cancel native focus transfer; clicks still activate the chosen button.
    if (target?.closest("button")) event.preventDefault();
  };
  const onFocusOut = (event: FocusEvent) => {
    // A null destination can be the focus guard's transient button blur.
    // Real pointer departures are handled by dismissBoardPopup in capture phase.
    if (event.relatedTarget instanceof Node && !element.contains(event.relatedTarget)) close();
  };
  const onWindowBlur = () => close();
  element.addEventListener("pointerdown", onPointerDown);
  element.addEventListener("focusout", onFocusOut);
  element.ownerDocument.defaultView?.addEventListener("blur", onWindowBlur);
  return {
    update(next) { close = next; },
    destroy() {
      element.removeEventListener("pointerdown", onPointerDown);
      element.removeEventListener("focusout", onFocusOut);
      element.ownerDocument.defaultView?.removeEventListener("blur", onWindowBlur);
    },
  };
};
