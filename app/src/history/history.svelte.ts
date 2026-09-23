/**
 * One sequential Undo/Redo history for text and board edits (R1.5, ROADMAP
 * "Технические границы" §3). Camera movement is not recorded.
 */
export interface HistoryCommand {
  /** Short English action name for the Undo log, e.g. "Move", "Edit text". */
  label: string;
  /** Human-readable name of the affected object, e.g. the note name. */
  target?: string;
  do(): void;
  undo(): void;
  /** Absorb a directly following command (e.g. continued typing). Return true if merged. */
  merge?(next: HistoryCommand): boolean;
}

export const history = $state({
  entries: [] as HistoryCommand[],
  /** Number of applied entries; entries[cursor..] form the Redo branch. */
  cursor: 0,
  limit: 64,
});

/** Run a command and record it. */
export function execute(command: HistoryCommand): void {
  command.do();
  record(command);
}

/** Record a command whose effect has already been applied (e.g. by the text editor). */
export function record(command: HistoryCommand): void {
  history.entries.splice(history.cursor);
  const last = history.entries[history.entries.length - 1];
  if (last?.merge?.(command)) return;
  history.entries.push(command);
  if (history.entries.length > history.limit) {
    history.entries.splice(0, history.entries.length - history.limit);
  }
  history.cursor = history.entries.length;
}

export function undo(): HistoryCommand | undefined {
  if (history.cursor === 0) return undefined;
  history.cursor -= 1;
  const command = history.entries[history.cursor];
  command.undo();
  return command;
}

export function redo(): HistoryCommand | undefined {
  if (history.cursor >= history.entries.length) return undefined;
  const command = history.entries[history.cursor];
  command.do();
  history.cursor += 1;
  return command;
}
