import { execute } from "../history/history.svelte";
import { board, updateNote } from "../model/board.svelte";
import { R5_KINDS, type Note, type NoteKind, type TaskState } from "../model/note";
import { registerCommand } from "../commands/registry.svelte";
import { selection } from "../selection/selection.svelte";
import { registerNoteMenuItem } from "../notes/noteMenu";
import { cloneTaskState, createReopenTaskCommand, createTaskCompletionCommand, createTaskFlagCommand } from "./taskTransitions";
import { taskLog, type TaskLogEntry } from "./taskLog.svelte";
import { tasksPanel, toggleTasksPanel } from "./tasksPanelState.svelte";

const nonTaskKinds = new Set<NoteKind>(["beacon", ...R5_KINDS]);

/** R5 display nodes and beacons cannot be task-flagged. */
export function canBeTask(note: Note | undefined): boolean {
  return Boolean(note && !nonTaskKinds.has(note.type));
}

function transitionStore() {
  return {
    getTask(noteId: string): TaskState | null {
      return cloneTaskState(board.notes[noteId]?.task);
    },
    setTask(noteId: string, task: TaskState | null): void {
      if (board.notes[noteId]) updateNote(noteId, { task: cloneTaskState(task) });
    },
    getUnmarkedTask(noteId: string): TaskState | null {
      return cloneTaskState(board.notes[noteId]?.taskMemory);
    },
    setUnmarkedTask(noteId: string, task: TaskState | null): void {
      if (board.notes[noteId]) updateNote(noteId, { taskMemory: cloneTaskState(task) });
    },
    addLogEntry(entry: TaskLogEntry): void {
      if (!taskLog.entries.some((item) => item.noteId === entry.noteId && item.doneAt === entry.doneAt)) {
        taskLog.entries.push(entry);
      }
    },
    removeLogEntry(entry: TaskLogEntry): void {
      for (let index = taskLog.entries.length - 1; index >= 0; index -= 1) {
        const item = taskLog.entries[index];
        if (item?.noteId === entry.noteId && item.name === entry.name && item.doneAt === entry.doneAt) {
          taskLog.entries.splice(index, 1);
          return;
        }
      }
    },
  };
}

export interface TaskCompletionResult {
  ok: boolean;
}

export function toggleTaskFlag(noteId: string): void {
  const note = board.notes[noteId];
  if (!canBeTask(note)) return;
  execute(createTaskFlagCommand(transitionStore(), noteId, note.name));
}

export function toggleTaskCompletion(noteId: string): TaskCompletionResult {
  const note = board.notes[noteId];
  if (!note?.task || !canBeTask(note)) return { ok: false };

  if (note.task.done) {
    const command = createReopenTaskCommand(transitionStore(), noteId, note.name);
    if (!command) return { ok: false };
    execute(command);
    return { ok: true };
  }

  const doneAt = nextCompletionTime(noteId, Date.now());
  const command = createTaskCompletionCommand(transitionStore(), noteId, note.name, doneAt);
  if (!command) return { ok: false };
  execute(command);
  return { ok: true };
}

function nextCompletionTime(noteId: string, now: number): number {
  const latest = taskLog.entries.reduce(
    (time, entry) => entry.noteId === noteId ? Math.max(time, entry.doneAt) : time,
    Number.NEGATIVE_INFINITY,
  );
  return Math.max(now, Number.isFinite(latest) ? latest + 1 : now);
}

registerNoteMenuItem({
  id: "task.toggleFlag",
  label: (noteId) => board.notes[noteId]?.task ? "Unmark as task" : "Mark as task",
  run: toggleTaskFlag,
  visible: (noteId) => canBeTask(board.notes[noteId]),
  order: 20,
});

registerCommand({
  id: "task.toggleFlag",
  label: "Mark or Unmark Task",
  keys: ["Shift+KeyT"],
  run: () => {
    if (selection.primaryId) toggleTaskFlag(selection.primaryId);
  },
});

registerCommand({
  id: "ui.toggleTasks",
  label: "Toggle Tasks Panel",
  keys: ["Shift+Alt+KeyT"],
  run: toggleTasksPanel,
  isActive: () => tasksPanel.open,
});
