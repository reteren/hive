export const TRANSFER_HINT_LIMIT = 5;
export const TRANSFER_HINT_DURATION_MS = 3_000;

/** A small lifetime budget shared by every transfer hint. */
export class TransferHintTimers {
  private timers = new Map<string, ReturnType<typeof setTimeout>>();

  constructor(
    private readonly shownCount: () => number,
    private readonly recordShown: () => void,
    private readonly onDismiss: (id: string) => void,
  ) {}

  show(id: string): boolean {
    if (this.timers.has(id) || this.shownCount() >= TRANSFER_HINT_LIMIT) return false;
    this.recordShown();
    this.timers.set(id, setTimeout(() => this.dismiss(id), TRANSFER_HINT_DURATION_MS));
    return true;
  }

  dismiss(id: string): void {
    const timer = this.timers.get(id);
    if (timer === undefined) return;
    clearTimeout(timer);
    this.timers.delete(id);
    this.onDismiss(id);
  }

  clear(): void {
    for (const timer of this.timers.values()) clearTimeout(timer);
    this.timers.clear();
  }
}
