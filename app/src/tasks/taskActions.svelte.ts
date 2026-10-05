import { execute } from "../history/history.svelte";
import { board, updateNote } from "../model/board.svelte";
import { links } from "../model/links.svelte";
import type { Note, TaskState } from "../model/note";
import { registerCommand } from "../commands/registry.svelte";
import { selection } from "../selection/selection.svelte";
import { registerNoteMenuItem } from "../notes/noteMenu";
import { cloneTaskState, createReopenTaskCommand, createTaskCompletionCommand, createTaskFlagCommand } from "./taskTransitions";
import { taskLog, type TaskLogEntry } from "./taskLog.svelte";
import { panelPopupState, togglePanelPopup } from "../ui/popups/panelPopupState.svelte";
import { linkedTaskCompletionForTime, linkedTimeStatesForTask } from "../time/taskLink";

/** Only ordinary notes and imported text files can be newly marked as tasks. */
export function canBeTask(note: Note | undefined): boolean {
  return Boolean(note && (note.type === "note" || note.type === "format" && note.media?.kind === "text"));
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
    getLinkedTimeStates(noteId: string) {
      const edges = Object.values(links.byId);
      return linkedTimeStatesForTask(noteId, edges, board.notes)
        .filter((time) => linkedTaskCompletionForTime(time.noteId, edges, board.notes, noteId).allDone);
    },
    setTimeEnabled(noteId: string, enabled: boolean): void {
      const time = board.notes[noteId]?.time;
      if (time) updateNote(noteId, { time: { ...time, enabled } });
    },
  };
}

export interface TaskCompletionResult {
  ok: boolean;
}

export function toggleTaskFlag(noteId: string): void {
  const targets = taskFlagTargets(noteId);
  if (targets.length === 0) return;

  const mark = targets.some((id) => !board.notes[id]?.task);
  const changed = targets.filter((id) => Boolean(board.notes[id]?.task) !== mark);
  const commands = changed.map((id) => {
    const note = board.notes[id]!;
    return createTaskFlagCommand(transitionStore(), id, note.name);
  });
  if (commands.length === 0) return;

  const firstChangedId = changed[0]!;
  execute({
    label: mark ? "Mark as task" : "Unmark as task",
    target: changed.length === 1 ? board.notes[firstChangedId]?.name : `${changed.length} nodes`,
    do: () => { for (const command of commands) command.do(); },
    undo: () => { for (let index = commands.length - 1; index >= 0; index -= 1) commands[index]?.undo(); },
  });
}

/** The RMB target expands to its selection; legacy tasks remain individually unmarkable. */
export function taskFlagTargets(noteId: string): string[] {
  const ids = selection.ids.includes(noteId) ? selection.ids : [noteId];
  return ids.filter((id) => {
    const note = board.notes[id];
    return Boolean(note && (canBeTask(note) || ids.length === 1 && id === noteId && note.task));
  });
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
  label: (noteId) => taskFlagTargets(noteId).some((id) => !board.notes[id]?.task) ? "Mark as task" : "Unmark task",
  run: toggleTaskFlag,
  visible: (noteId) => Boolean(board.notes[noteId]?.task || canBeTask(board.notes[noteId])),
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
  run: () => togglePanelPopup("tasks"),
  isActive: () => panelPopupState.active === "tasks",
});
