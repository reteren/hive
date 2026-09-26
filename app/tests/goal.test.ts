import { beforeEach, describe, expect, it } from "vitest";
import { clear, execute, redo, undo } from "../src/history/history.svelte";
import { addLink, removeLink, replaceLinks } from "../src/model/links.svelte";
import type { Link } from "../src/model/link";
import { addNote, board, replaceBoard, updateNote } from "../src/model/board.svelte";
import type { Note, NoteKind } from "../src/model/note";
import { canBeTask, toggleTaskFlag } from "../src/tasks/taskActions.svelte";
import { noteMenuItems } from "../src/notes/noteMenu";
import { goalState, visibleGoalRows } from "../src/goal/goal";
import { canCreateLinkPair } from "../src/links/rules";

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
  it("counts direct tasks and their upstream subtasks separately", () => {
    replaceBoard([note("goal", "goal"), note("a", "note"), note("b", "note", true)]);
    replaceLinks([link("a-b", "a", "b"), link("b-goal", "b", "goal")]);

    expect(goalState("goal")).toEqual({ connected: 1, done: 1, subtasks: 1, doneSubtasks: 0, goals: 0, goldGoals: 0, gold: true });
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
    expect(goalState("goal")).toEqual({ connected: 1, done: 0, subtasks: 0, doneSubtasks: 0, goals: 0, goldGoals: 0, gold: false });

    redo();
    expect(goalState("goal")).toEqual({ connected: 1, done: 1, subtasks: 0, doneSubtasks: 0, goals: 0, goldGoals: 0, gold: true });
  });

  it("drops gold when a new open task is linked and restores it when the link is removed", () => {
    replaceBoard([note("goal", "goal"), note("done", "note", true)]);
    replaceLinks([link("done-goal", "done", "goal")]);
    expect(goalState("goal").gold).toBe(true);

    addNote(note("open"));
    addLink(link("open-goal", "open", "goal"));
    expect(goalState("goal")).toEqual({ connected: 2, done: 1, subtasks: 0, doneSubtasks: 0, goals: 0, goldGoals: 0, gold: false });

    removeLink("open-goal");
    expect(goalState("goal")).toEqual({ connected: 1, done: 1, subtasks: 0, doneSubtasks: 0, goals: 0, goldGoals: 0, gold: true });
  });

  it("ignores weak links and does not turn an empty Goal gold", () => {
    replaceBoard([note("goal", "goal"), note("task", "note", true)]);
    replaceLinks([link("weak", "task", "goal", "weak"), link("out", "goal", "task")]);

    expect(goalState("goal")).toEqual({ connected: 0, done: 0, subtasks: 0, doneSubtasks: 0, goals: 0, goldGoals: 0, gold: false });
  });

  it("stops counting a linked note when its task flag is removed", () => {
    replaceBoard([note("goal", "goal"), note("task", "note", true)]);
    replaceLinks([link("task-goal", "task", "goal")]);
    expect(goalState("goal").gold).toBe(true);

    updateNote("task", { task: null });
    expect(goalState("goal")).toEqual({ connected: 0, done: 0, subtasks: 0, doneSubtasks: 0, goals: 0, goldGoals: 0, gold: false });
  });

  it("counts the full upstream task chain without counting direct tasks as subtasks", () => {
    replaceBoard([
      note("goal", "goal"),
      note("task0", "note"),
      note("task1", "note"),
      note("task2", "note"),
    ]);
    replaceLinks([
      link("task0-task1", "task0", "task1"),
      link("task1-task2", "task1", "task2"),
      link("task2-goal", "task2", "goal"),
    ]);

    expect(goalState("goal")).toEqual({
      connected: 1,
      done: 0,
      subtasks: 2,
      doneSubtasks: 0,
      goals: 0,
      goldGoals: 0,
      gold: false,
    });

    updateNote("task0", { task: { done: true, doneAt: 2 } });
    expect(goalState("goal").doneSubtasks).toBe(1);
  });

  it("counts a shared upstream task only once", () => {
    replaceBoard([
      note("goal", "goal"),
      note("shared", "note", true),
      note("left", "note"),
      note("right", "note"),
    ]);
    replaceLinks([
      link("shared-left", "shared", "left"),
      link("shared-right", "shared", "right"),
      link("left-goal", "left", "goal"),
      link("right-goal", "right", "goal"),
    ]);

    expect(goalState("goal")).toEqual({
      connected: 2,
      done: 0,
      subtasks: 1,
      doneSubtasks: 1,
      goals: 0,
      goldGoals: 0,
      gold: false,
    });
  });

  it("allows strong goal-to-goal links and propagates gold through a goal chain", () => {
    const notes = [note("parent", "goal"), note("middle", "goal"), note("child", "goal"),
      note("parent-task", "note", true), note("middle-task", "note", true), note("child-task", "note", true)];
    replaceBoard(notes);
    expect(canCreateLinkPair("child", "middle", [], "strong", board.notes)).toBe(true);
    replaceLinks([
      link("child-task-link", "child-task", "child"),
      link("middle-task-link", "middle-task", "middle"),
      link("parent-task-link", "parent-task", "parent"),
      link("child-middle", "child", "middle"),
      link("middle-parent", "middle", "parent"),
    ]);

    expect(goalState("child")).toMatchObject({ goals: 0, goldGoals: 0, gold: true });
    expect(goalState("middle")).toMatchObject({ goals: 1, goldGoals: 1, gold: true });
    expect(goalState("parent")).toMatchObject({ connected: 1, done: 1, goals: 1, goldGoals: 1, gold: true });

    updateNote("child-task", { task: { done: false, doneAt: null } });
    expect(goalState("child").gold).toBe(false);
    expect(goalState("middle")).toMatchObject({ goldGoals: 0, gold: false });
    expect(goalState("parent")).toMatchObject({ goldGoals: 0, gold: false });
  });

  it("keeps every goal in a cycle non-gold even when all tasks are done", () => {
    replaceBoard([
      note("a", "goal"), note("b", "goal"), note("c", "goal"),
      note("a-task", "note", true), note("b-task", "note", true), note("c-task", "note", true),
    ]);
    replaceLinks([
      link("a-task-link", "a-task", "a"), link("b-task-link", "b-task", "b"),
      link("c-task-link", "c-task", "c"), link("a-b", "a", "b"),
      link("b-c", "b", "c"), link("c-a", "c", "a"),
    ]);

    for (const id of ["a", "b", "c"]) {
      expect(goalState(id)).toMatchObject({ connected: 1, done: 1, goals: 1, goldGoals: 0, gold: false });
    }
  });

  it("shows only populated rows in task, subtask, goal order", () => {
    replaceBoard([note("parent", "goal"), note("child", "goal"),
      note("direct", "note", true), note("upstream", "note", true), note("child-task", "note", true)]);
    expect(visibleGoalRows(goalState("parent"))).toEqual([]);

    replaceLinks([link("child-task-link", "child-task", "child"), link("child-parent", "child", "parent")]);
    expect(goalState("parent")).toMatchObject({ connected: 0, goals: 1, goldGoals: 1, gold: true });
    expect(visibleGoalRows(goalState("parent"))).toEqual([
      { kind: "goals", done: 1, total: 1, label: "goals" },
    ]);

    addLink(link("direct-parent", "direct", "parent"));
    expect(visibleGoalRows(goalState("parent")).map((row) => row.kind)).toEqual(["tasks", "goals"]);

    addLink(link("upstream-direct", "upstream", "direct"));
    expect(visibleGoalRows(goalState("parent"))).toEqual([
      { kind: "tasks", done: 1, total: 1, label: "task done" },
      { kind: "subtasks", done: 1, total: 1, label: "subtasks" },
      { kind: "goals", done: 1, total: 1, label: "goals" },
    ]);
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
