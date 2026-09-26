import { beforeEach, describe, expect, it } from "vitest";
import { clear, execute, redo, undo } from "../src/history/history.svelte";
import { addLink, removeLink, replaceLinks } from "../src/model/links.svelte";
import type { Link } from "../src/model/link";
import { addNote, board, replaceBoard, updateNote } from "../src/model/board.svelte";
import type { Note, NoteKind } from "../src/model/note";
import { canBeTask, toggleTaskFlag } from "../src/tasks/taskActions.svelte";
import { noteMenuItems } from "../src/notes/noteMenu";
import { goalState } from "../src/goal/goal";

function note(id: string, type: NoteKind = "note", done = false): Note {
  return {
    id,
    type,
    name: id,
    text: "",
    x: 0,
    y: 0,
    width: 30,
    height: null,
    task: type === "goal" ? null : { done, doneAt: done ? 1 : null },
  };
}

function link(id: string, from: string, to: string, kind: Link["kind"] = "strong"): Link {
  return { id, from, to, kind, shape: "base" };
}

beforeEach(() => {
  clear();
  replaceBoard([]);
  replaceLinks([]);
});

describe("Goal node", () => {
  it("counts only tasks directly connected into the Goal", () => {
    replaceBoard([note("goal", "goal"), note("a", "note"), note("b", "note", true)]);
    replaceLinks([link("a-b", "a", "b"), link("b-goal", "b", "goal")]);

    expect(goalState("goal")).toEqual({ connected: 1, done: 1, gold: true });
  });

  it("updates gold immediately through Undo and Redo", () => {
    const task = note("task");
    replaceBoard([note("goal", "goal"), task]);
    replaceLinks([link("task-goal", "task", "goal")]);

    const done = { done: true, doneAt: 10 };
    const open = { done: false, doneAt: null };
    execute({
      label: "Complete task",
      do: () => updateNote("task", { task: done }),
      undo: () => updateNote("task", { task: open }),
    });
    expect(goalState("goal").gold).toBe(true);

    undo();
    expect(goalState("goal")).toEqual({ connected: 1, done: 0, gold: false });

    redo();
    expect(goalState("goal")).toEqual({ connected: 1, done: 1, gold: true });
  });

  it("drops gold when a new open task is linked and restores it when the link is removed", () => {
    replaceBoard([note("goal", "goal"), note("done", "note", true)]);
    replaceLinks([link("done-goal", "done", "goal")]);
    expect(goalState("goal").gold).toBe(true);

    addNote(note("open"));
    addLink(link("open-goal", "open", "goal"));
    expect(goalState("goal")).toEqual({ connected: 2, done: 1, gold: false });

    removeLink("open-goal");
    expect(goalState("goal")).toEqual({ connected: 1, done: 1, gold: true });
  });

  it("ignores weak links and does not turn an empty Goal gold", () => {
    replaceBoard([note("goal", "goal"), note("task", "note", true)]);
    replaceLinks([link("weak", "task", "goal", "weak"), link("out", "goal", "task")]);

    expect(goalState("goal")).toEqual({ connected: 0, done: 0, gold: false });
  });

  it("stops counting a linked note when its task flag is removed", () => {
    replaceBoard([note("goal", "goal"), note("task", "note", true)]);
    replaceLinks([link("task-goal", "task", "goal")]);
    expect(goalState("goal").gold).toBe(true);

    updateNote("task", { task: null });
    expect(goalState("goal")).toEqual({ connected: 0, done: 0, gold: false });
  });

  it("prevents beacons and all R5 nodes from becoming tasks", () => {
    for (const type of ["beacon", "goal", "progress", "calculator", "tierlist", "stats"] as const) {
      expect(canBeTask(note(type, type))).toBe(false);
      replaceBoard([note(type, type)]);
      const taskBefore = board.notes[type]?.task;
      toggleTaskFlag(type);
      expect(board.notes[type]?.task).toBe(taskBefore);
      expect(noteMenuItems(type).some((item) => item.id === "task.toggleFlag")).toBe(false);
    }
    expect(canBeTask(note("plain"))).toBe(true);
  });
});
