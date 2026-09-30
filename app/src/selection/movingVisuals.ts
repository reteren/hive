export interface MovingVisualTarget {
  style: { opacity: string };
  dataset: { movePreview?: string };
}

interface PreviousVisualState {
  opacity: string;
  movePreview: string | undefined;
}

/** Fade only the cards participating in a move, then restore their exact prior inline state. */
export class MovingVisuals<T extends MovingVisualTarget> {
  private readonly previous = new Map<T, PreviousVisualState>();

  setTargets(targets: readonly T[]): void {
    const next = new Set(targets);
    for (const [target, state] of this.previous) {
      if (next.has(target)) continue;
      this.restore(target, state);
      this.previous.delete(target);
    }

    for (const target of next) {
      if (!this.previous.has(target)) {
        this.previous.set(target, {
          opacity: target.style.opacity,
          movePreview: target.dataset.movePreview,
        });
      }
      target.style.opacity = "0.7";
      target.dataset.movePreview = "true";
    }
  }

  clear(): void {
    this.setTargets([]);
  }

  private restore(target: T, state: PreviousVisualState): void {
    target.style.opacity = state.opacity;
    if (state.movePreview === undefined) delete target.dataset.movePreview;
    else target.dataset.movePreview = state.movePreview;
  }
}
