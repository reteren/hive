import { describe, expect, it } from "vitest";
import { HistoryStack } from "../src/history/historyStack";
import type { Note, TaskState } from "../src/model/note";
import type { TaskLogEntry } from "../src/tasks/taskLog.svelte";
import {
  createTaskCompletionCommand,
  createReopenTaskCommand,
  createTaskFlagCommand,
  openTasks,
  taskHistory,
  type TaskTransitionStore,
} from "../src/tasks/taskTransitions";

function createStore(initial: Record<string, TaskState | null> = {}) {
  const tasks = new Map(Object.entries(initial));
  const remembered = new Map<string, TaskState>();
  const entries: TaskLogEntry[] = [];
  const store: TaskTransitionStore = {
    getTask: (id) => tasks.get(id) ?? null,
    setTask: (id, task) => {
      if (task) tasks.set(id, { ...task });
      else tasks.delete(id);
    },
    getUnmarkedTask: (id) => remembered.get(id) ?? null,
    setUnmarkedTask: (id, task) => {
      if (task) remembered.set(id, { ...task });
      else remembered.delete(id);
    },
    addLogEntry: (entry) => { entries.push(entry); },
    removeLogEntry: (entry) => {
      const index = entries.findIndex((item) =>
        item.noteId === entry.noteId && item.name === entry.name && item.doneAt === entry.doneAt,
      );
      if (index !== -1) entries.splice(index, 1);
    },
  };
  return { store, tasks, remembered, entries };
}

const note = (id: string, createdAt: number, task: TaskState | null, name = id): Note => ({
  id,
  type: "note",
  name,
  text: "",
  x: 0,
  y: 0,
  width: 30,
  height: null,
  createdAt,
  task,
});

describe("task transitions", () => {
  it("unmarking and remarking restores the previous state without adding work-log entries", () => {
    const { store, tasks, entries } = createStore({ "task-a": { done: true, doneAt: 42 } });
    entries.push({ noteId: "task-a", name: "task-a", doneAt: 42 });
    const stack = new HistoryStack();

    stack.execute(createTaskFlagCommand(store, "task-a", "task-a"));
    expect(tasks.has("task-a")).toBe(false);
    expect(entries).toHaveLength(1);

    stack.execute(createTaskFlagCommand(store, "task-a", "task-a"));
    expect(tasks.get("task-a")).toEqual({ done: true, doneAt: 42 });
    expect(entries).toHaveLength(1);

    stack.undo();
    expect(tasks.has("task-a")).toBe(false);
    stack.redo();
    expect(tasks.get("task-a")).toEqual({ done: true, doneAt: 42 });
    expect(entries).toHaveLength(1);
  });

  it("restores an open task state after unmarking even when its log has older completions", () => {
    const { store, tasks, entries } = createStore({ "task-a": { done: false, doneAt: null } });
    entries.push({ noteId: "task-a", name: "task-a", doneAt: 12 });
    const stack = new HistoryStack();

    stack.execute(createTaskFlagCommand(store, "task-a", "task-a"));
    stack.execute(createTaskFlagCommand(store, "task-a", "task-a"));

    expect(tasks.get("task-a")).toEqual({ done: false, doneAt: null });
    expect(entries).toHaveLength(1);
  });

  it("undoing the initial task mark restores an unmarked note without task memory", () => {
    const { store, tasks, remembered } = createStore();
    const stack = new HistoryStack();

    stack.execute(createTaskFlagCommand(store, "new", "New note"));
    expect(tasks.get("new")).toEqual({ done: false, doneAt: null });
    stack.undo();

    expect(tasks.has("new")).toBe(false);
    expect(remembered.has("new")).toBe(false);
  });

  it("records completion, removes its log entry on undo, and restores it on redo", () => {
    const { store, tasks, entries } = createStore({ "task-a": { done: false, doneAt: null } });
    const stack = new HistoryStack();
    const command = createTaskCompletionCommand(store, "task-a", "Write tests", 100);
    expect(command).toBeDefined();
    if (!command) return;

    stack.execute(command);
    expect(tasks.get("task-a")).toEqual({ done: true, doneAt: 100 });
    expect(entries).toEqual([{ noteId: "task-a", name: "Write tests", doneAt: 100 }]);

    stack.undo();
    expect(tasks.get("task-a")).toEqual({ done: false, doneAt: null });
    expect(entries).toEqual([]);

    stack.redo();
    expect(tasks.get("task-a")).toEqual({ done: true, doneAt: 100 });
    expect(entries).toEqual([{ noteId: "task-a", name: "Write tests", doneAt: 100 }]);
  });

  it("returns no second completion command for an already completed task", () => {
    const { store, tasks, entries } = createStore({ "task-a": { done: true, doneAt: 50 } });
    expect(createTaskCompletionCommand(store, "task-a", "A", 100)).toBeNull();
    expect(tasks.get("task-a")).toEqual({ done: true, doneAt: 50 });
    expect(entries).toEqual([]);
  });

  it("disables linked Times on completion and restores each prior enabled state with one Undo", () => {
    const { store, tasks, entries } = createStore({ "task-a": { done: false, doneAt: null } });
    const times = new Map([["running", true], ["already-stopped", false]]);
    const transitionStore: TaskTransitionStore = {
      ...store,
      getLinkedTimeStates: () => [...times].map(([noteId, enabled]) => ({ noteId, enabled })),
      setTimeEnabled: (noteId, enabled) => { times.set(noteId, enabled); },
    };
    const stack = new HistoryStack();
    const command = createTaskCompletionCommand(transitionStore, "task-a", "Write tests", 100);
    expect(command).not.toBeNull();
    if (!command) return;

    stack.execute(command);
    expect(times).toEqual(new Map([["running", false], ["already-stopped", false]]));
    expect(tasks.get("task-a")).toEqual({ done: true, doneAt: 100 });
    stack.undo();
    expect(times).toEqual(new Map([["running", true], ["already-stopped", false]]));
    expect(tasks.get("task-a")).toEqual({ done: false, doneAt: null });
    expect(entries).toEqual([]);
    stack.redo();
    expect(times).toEqual(new Map([["running", false], ["already-stopped", false]]));
  });

  it("reopening leaves prior completion history intact through undo and redo", () => {
    const { store, tasks, entries } = createStore({ "task-a": { done: true, doneAt: 100 } });
    entries.push({ noteId: "task-a", name: "A", doneAt: 100 });
    const command = createReopenTaskCommand(store, "task-a", "A");
    expect(command).toBeDefined();
    if (!command) return;
    const stack = new HistoryStack();

    stack.execute(command);
    expect(tasks.get("task-a")).toEqual({ done: false, doneAt: null });
    expect(entries).toHaveLength(1);
    stack.undo();
    expect(tasks.get("task-a")).toEqual({ done: true, doneAt: 100 });
    expect(entries).toHaveLength(1);
    stack.redo();
    expect(tasks.get("task-a")).toEqual({ done: false, doneAt: null });
    expect(entries).toHaveLength(1);
  });

  it("sorts open tasks by creation time and excludes completed tasks board-wide", () => {
    const notes = [
      note("later", 30, { done: false, doneAt: null }),
      note("done", 5, { done: true, doneAt: 50 }),
      note("earlier", 10, { done: false, doneAt: null }),
      note("ordinary", 1, null),
    ];

    expect(openTasks(notes).map(({ id }) => id)).toEqual(["earlier", "later"]);
  });

  it("orders completion history newest first without mutating the source", () => {
    const entries = [
      { noteId: "a", name: "A", doneAt: 10 },
      { noteId: "b", name: "B", doneAt: 30 },
      { noteId: "c", name: "C", doneAt: 20 },
    ];

    expect(taskHistory(entries).map(({ noteId }) => noteId)).toEqual(["b", "c", "a"]);
    expect(entries.map(({ noteId }) => noteId)).toEqual(["a", "b", "c"]);
  });
});
