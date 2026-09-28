export interface QuickInputWindowHandle {
  isVisible(): Promise<boolean>;
  center(): Promise<void>;
  show(): Promise<void>;
  setFocus(): Promise<void>;
}

/** Showing is idempotent: a stale visibility read must never turn an open into a hide. */
export async function showQuickInputWindow(window: QuickInputWindowHandle): Promise<void> {
  let visible = false;
  try {
    visible = await window.isVisible();
  } catch {
    // The visibility read only controls positioning; it must not block opening.
  }
  if (!visible) {
    try {
      await window.center();
    } catch {
      // Showing and focusing are the required activation actions.
    }
  }
  await window.show();
  await window.setFocus();
}
