export interface HoverIntent {
  pointerEnter(): void;
  pointerLeave(): void;
  focus(): void;
  blur(): void;
  dispose(): void;
}

/** Keep a popover open while its trigger or content is active, with a small leave grace period. */
export function createHoverIntent(
  onOpenChange: (open: boolean) => void,
  graceMs = 250,
): HoverIntent {
  let pointerInside = false;
  let focused = false;
  let open = false;
  let disposed = false;
  let timer: ReturnType<typeof setTimeout> | null = null;

  const setOpen = (next: boolean): void => {
    if (open === next) return;
    open = next;
    onOpenChange(open);
  };

  const clearTimer = (): void => {
    if (timer === null) return;
    clearTimeout(timer);
    timer = null;
  };

  const scheduleClose = (): void => {
    clearTimer();
    if (pointerInside || focused || disposed) return;
    timer = setTimeout(() => {
      timer = null;
      if (!pointerInside && !focused) setOpen(false);
    }, Math.max(0, graceMs));
  };

  return {
    pointerEnter() {
      pointerInside = true;
      clearTimer();
      setOpen(true);
    },
    pointerLeave() {
      pointerInside = false;
      scheduleClose();
    },
    focus() {
      focused = true;
      clearTimer();
      setOpen(true);
    },
    blur() {
      focused = false;
      scheduleClose();
    },
    dispose() {
      disposed = true;
      clearTimer();
    },
  };
}
