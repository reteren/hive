export interface HoverGraceTimer {
  cancel(): void;
  schedule(): void;
}

export function createHoverGraceTimer(onExpire: () => void, delayMs = 150): HoverGraceTimer {
  let timeout: ReturnType<typeof setTimeout> | undefined;

  function cancel(): void {
    if (timeout !== undefined) clearTimeout(timeout);
    timeout = undefined;
  }

  function schedule(): void {
    cancel();
    timeout = setTimeout(() => {
      timeout = undefined;
      onExpire();
    }, delayMs);
  }

  return { cancel, schedule };
}
