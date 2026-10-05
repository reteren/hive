/** A user-visible operation in the shared text and board history. */
export interface HistoryCommand {
  /** Short English action name shown in the Undo log. */
  label: string;
  /** Human-readable name of the affected object, when there is one. */
  target?: string;
  do(): void;
  undo(): void;
  /** Absorb a directly following command. Return true when it was merged. */
  merge?(next: HistoryCommand): boolean;
}

export const DEFAULT_HISTORY_LIMIT = 64;
export const MIN_HISTORY_LIMIT = 8;
export const MAX_HISTORY_LIMIT = 1000;

export function normalizeHistoryLimit(limit: number): number {
  if (!Number.isFinite(limit)) return DEFAULT_HISTORY_LIMIT;
  return Math.min(MAX_HISTORY_LIMIT, Math.max(MIN_HISTORY_LIMIT, Math.trunc(limit)));
}

/** Svelte-independent stack logic. Commands own their domain-specific mutations. */
export class HistoryStack {
  entries: HistoryCommand[] = [];
  cursor = 0;
  limit: number;
  private readonly transactions: Array<{ label: string; commands: HistoryCommand[] }> = [];

  constructor(limit = DEFAULT_HISTORY_LIMIT) {
    this.limit = normalizeHistoryLimit(limit);
  }

  execute(command: HistoryCommand): void {
    command.do();
    this.record(command);
  }

  /** Record a command whose effect has already been applied. */
  record(command: HistoryCommand): void {
    const transaction = this.transactions[this.transactions.length - 1];
    if (transaction) {
      // Transaction children have already run. Keep each intact so abort can
      // undo exactly what was applied, and so none can merge across a boundary.
      transaction.commands.push(command);
      return;
    }
    this.recordDirect(command, true);
  }

  beginTransaction(label: string): void {
    this.transactions.push({ label, commands: [] });
  }

  commitTransaction(): HistoryCommand | undefined {
    const transaction = this.transactions.pop();
    if (!transaction) throw new Error("No history transaction is active.");
    if (transaction.commands.length === 0) return undefined;

    const commands = [...transaction.commands];
    const composite: HistoryCommand = {
      label: transaction.label,
      do() {
        for (const command of commands) command.do();
      },
      undo() {
        for (let index = commands.length - 1; index >= 0; index -= 1) {
          commands[index].undo();
        }
      },
    };

    const parent = this.transactions[this.transactions.length - 1];
    if (parent) parent.commands.push(composite);
    else this.recordDirect(composite, false);
    return composite;
  }

  abortTransaction(): void {
    const transaction = this.transactions.pop();
    if (!transaction) throw new Error("No history transaction is active.");
    let firstError: unknown;
    for (let index = transaction.commands.length - 1; index >= 0; index -= 1) {
      try {
        transaction.commands[index].undo();
      } catch (error) {
        firstError ??= error;
      }
    }
    if (firstError !== undefined) throw firstError;
  }

  private recordDirect(command: HistoryCommand, allowMerge: boolean): void {
    this.entries.splice(this.cursor);
    const last = this.entries[this.entries.length - 1];
    if (allowMerge && last?.merge) {
      try {
        if (last.merge(command)) return;
      } catch {
        // A failed coalesce must not leave an already-applied edit unrecorded.
      }
    }

    this.entries.push(command);
    this.cursor = this.entries.length;
    this.trimOldest();
  }

  undo(): HistoryCommand | undefined {
    if (this.cursor === 0) return undefined;
    const command = this.entries[this.cursor - 1];
    command.undo();
    this.cursor -= 1;
    return command;
  }

  redo(): HistoryCommand | undefined {
    if (this.cursor >= this.entries.length) return undefined;
    const command = this.entries[this.cursor];
    command.do();
    this.cursor += 1;
    return command;
  }

  /** Move to the state after `index` entries, applying each transition in order. */
  jumpTo(index: number): number {
    if (!Number.isInteger(index) || index < 0 || index > this.entries.length) {
      throw new RangeError(`History index must be between 0 and ${this.entries.length}.`);
    }
    while (this.cursor > index) this.undo();
    while (this.cursor < index) this.redo();
    return this.cursor;
  }

  setLimit(limit: number): void {
    this.limit = normalizeHistoryLimit(limit);
    if (this.entries.length <= this.limit) return;

    // Keep the current state inside the retained window. If the cursor is near
    // the beginning, preserve the earliest Redo steps rather than keeping later
    // commands whose preconditions depend on Redo entries that were discarded.
    const start = Math.max(0, this.cursor - this.limit);
    const end = Math.min(this.entries.length, start + this.limit);
    this.entries = this.entries.slice(start, end);
    this.cursor -= start;
  }

  clear(): void {
    this.entries = [];
    this.cursor = 0;
  }

  private trimOldest(): void {
    const overflow = this.entries.length - this.limit;
    if (overflow <= 0) return;
    this.entries.splice(0, overflow);
    this.cursor = Math.max(0, this.cursor - overflow);
  }
}
