export interface ControlsAutoHide {
  setPlaying(playing: boolean): void;
  pointerActivity(): void;
  pointerLeave(): void;
  dispose(): void;
}

/** Keep custom player controls visible while paused and briefly after pointer activity. */
export function createControlsAutoHide(
  onVisibilityChange: (visible: boolean) => void,
  delayMs = 500,
): ControlsAutoHide {
  let visible = true;
  let playing = false;
  let disposed = false;
  let timer: ReturnType<typeof setTimeout> | null = null;

  const setVisible = (next: boolean): void => {
    if (visible === next) return;
    visible = next;
    onVisibilityChange(next);
  };

  const clearTimer = (): void => {
    if (timer === null) return;
    clearTimeout(timer);
    timer = null;
  };

  const scheduleHide = (): void => {
    clearTimer();
    if (!playing || disposed) return;
    timer = setTimeout(() => {
      timer = null;
      setVisible(false);
    }, Math.max(0, delayMs));
  };

  return {
    setPlaying(nextPlaying) {
      playing = nextPlaying;
      if (playing) scheduleHide();
      else {
        clearTimer();
        setVisible(true);
      }
    },
    pointerActivity() {
      setVisible(true);
      if (playing) scheduleHide();
    },
    pointerLeave() {
      if (playing) scheduleHide();
    },
    dispose() {
      disposed = true;
      clearTimer();
    },
  };
}
