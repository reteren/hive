import { execute } from "../history/history.svelte";
import { board, updateNote } from "../model/board.svelte";
import type { TaskState } from "../model/note";
import { registerCommand } from "../commands/registry.svelte";
import { selection } from "../selection/selection.svelte";
import { canCompleteTask } from "./dependencies";
import { registerNoteMenuItem } from "../notes/noteMenu";
import { attemptTaskCompletion, cloneTaskState, createReopenTaskCommand, createTaskFlagCommand } from "./taskTransitions";
import { taskLog, type TaskLogEntry } from "./taskLog.svelte";
import { tasksPanel, toggleTasksPanel } from "./tasksPanelState.svelte";

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
  reason?: string;
}

export function toggleTaskFlag(noteId: string): void {
  const note = board.notes[noteId];
  if (!note) return;
  execute(createTaskFlagCommand(transitionStore(), noteId, note.name));
}

export function toggleTaskCompletion(noteId: string): TaskCompletionResult {
  const note = board.notes[noteId];
  if (!note?.task) return { ok: false };

  if (note.task.done) {
    const command = createReopenTaskCommand(transitionStore(), noteId, note.name);
    if (!command) return { ok: false };
    execute(command);
    return { ok: true };
  }

  const doneAt = nextCompletionTime(noteId, Date.now());
  const attempt = attemptTaskCompletion(
    transitionStore(),
    noteId,
    note.name,
    doneAt,
    canCompleteTask,
  );
  if (!attempt.command) {
    if (!attempt.blockers.length) return { ok: false };
    const names = attempt.blockers.map((id) => board.notes[id]?.name ?? "Unknown task");
    return { ok: false, reason: `Blocked by ${names.join(", ")}.` };
  }

  execute(attempt.command);
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
  visible: (noteId) => Boolean(board.notes[noteId]),
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
