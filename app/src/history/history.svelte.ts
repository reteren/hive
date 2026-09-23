/**
 * One sequential Undo/Redo history for text and board edits (R1.5, ROADMAP
 * "Технические границы" §3). Camera movement is not recorded.
 */
import {
  DEFAULT_HISTORY_LIMIT,
  HistoryStack,
  type HistoryCommand,
} from "./historyStack";

export type { HistoryCommand } from "./historyStack";
export { DEFAULT_HISTORY_LIMIT, MAX_HISTORY_LIMIT, MIN_HISTORY_LIMIT } from "./historyStack";

const stack = new HistoryStack();

export const history = $state({
  entries: [] as HistoryCommand[],
  /** Number of applied entries; entries[cursor..] form the Redo branch. */
  cursor: 0,
  limit: DEFAULT_HISTORY_LIMIT,
});

export type HistoryFeedback = {
  id: number;
  message: string;
  tone: "action" | "muted";
};

export const historyFeedback = $state({ current: null as HistoryFeedback | null });

/** Unpinned logs close after a history row is selected; pin keeps browsing open. */
export const undoLogPanel = $state({ open: false, pinned: false });

let feedbackId = 0;
let feedbackTimer: ReturnType<typeof setTimeout> | undefined;

function syncState(): void {
  history.entries = [...stack.entries];
  history.cursor = stack.cursor;
  history.limit = stack.limit;
}

function showFeedback(message: string, tone: HistoryFeedback["tone"]): void {
  if (feedbackTimer !== undefined) clearTimeout(feedbackTimer);
  const id = ++feedbackId;
  historyFeedback.current = { id, message, tone };
  feedbackTimer = setTimeout(() => {
    if (historyFeedback.current?.id === id) historyFeedback.current = null;
    feedbackTimer = undefined;
  }, 2_000);
}

function actionCaption(verb: "Undo" | "Redo", command: HistoryCommand): string {
  const target = command.target?.trim();
  return `${verb}: ${command.label}${target ? ` — ${target}` : ""}`;
}

/** Run a command and record it. A thrown `do` leaves the stack untouched. */
export function execute(command: HistoryCommand): void {
  stack.execute(command);
  syncState();
}

/** Record a command whose effect has already been applied (e.g. by the text editor). */
export function record(command: HistoryCommand): void {
  stack.record(command);
  syncState();
}

export function undo(): HistoryCommand | undefined {
  let command: HistoryCommand | undefined;
  try {
    command = stack.undo();
  } catch (error) {
    syncState();
    showFeedback("Undo failed", "muted");
    throw error;
  }
  syncState();
  showFeedback(command ? actionCaption("Undo", command) : "Nothing to undo", command ? "action" : "muted");
  return command;
}

export function redo(): HistoryCommand | undefined {
  let command: HistoryCommand | undefined;
  try {
    command = stack.redo();
  } catch (error) {
    syncState();
    showFeedback("Redo failed", "muted");
    throw error;
  }
  syncState();
  showFeedback(command ? actionCaption("Redo", command) : "Nothing to redo", command ? "action" : "muted");
  return command;
}

/** Reach a state by applying the same ordered Undo/Redo steps as the commands. */
export function jumpTo(index: number): number {
  const previousCursor = stack.cursor;
  try {
    stack.jumpTo(index);
  } catch (error) {
    syncState();
    showFeedback("History change failed", "muted");
    throw error;
  }

  syncState();
  if (stack.cursor > previousCursor) {
    const command = stack.entries[stack.cursor - 1];
    if (command) showFeedback(actionCaption("Redo", command), "action");
  } else if (stack.cursor < previousCursor) {
    const command = stack.entries[stack.cursor];
    if (command) showFeedback(actionCaption("Undo", command), "action");
  }
  return stack.cursor;
}

/** Change the retained operation count, preserving the newest entries. */
export function setHistoryLimit(limit: number): void {
  stack.setLimit(limit);
  syncState();
}

/** Forget the history without changing the current board/document state. */
export function clear(): void {
  stack.clear();
  syncState();
  if (feedbackTimer !== undefined) clearTimeout(feedbackTimer);
  feedbackTimer = undefined;
  historyFeedback.current = null;
}

export function toggleUndoLog(): void {
  undoLogPanel.open = !undoLogPanel.open;
}

export function closeUndoLog(): void {
  undoLogPanel.open = false;
}

export function toggleUndoLogPin(): void {
  undoLogPanel.pinned = !undoLogPanel.pinned;
}
