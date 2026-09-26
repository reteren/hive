import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { clear, history, redo, undo } from "../src/history/history.svelte";
import { board, replaceBoard } from "../src/model/board.svelte";
import type { Link } from "../src/model/link";
import { replaceLinks } from "../src/model/links.svelte";
import type { Note } from "../src/model/note";
import { taskLog } from "../src/tasks/taskLog.svelte";
import { toggleTaskCompletion } from "../src/tasks/taskActions.svelte";

function taskNote(id: string, done = false): Note {
  return {
    id,
    type: "note",
    name: id,
    text: "",
    x: 0,
    y: 0,
    width: 30,
    height: null,
    task: { done, doneAt: done ? 1 : null },
  };
}

function strong(from: string, to: string): Link {
  return { id: `${from}-${to}`, from, to, kind: "strong", shape: "base" };
}

beforeEach(() => {
  clear();
  replaceBoard([]);
  replaceLinks([]);
  taskLog.entries = [];
});

afterEach(() => {
  clear();
  replaceBoard([]);
  replaceLinks([]);
  taskLog.entries = [];
});

describe("task completion without predecessor blocking", () => {
  it("lets a task complete with an open task linked into it and keeps Undo/log behavior", () => {
    replaceBoard([taskNote("predecessor"), taskNote("target")]);
    replaceLinks([strong("predecessor", "target")]);

    expect(toggleTaskCompletion("target")).toEqual({ ok: true });
    expect(boardTask("target")).toMatchObject({ done: true });
    expect(boardTask("predecessor")).toMatchObject({ done: false });
    expect(taskLog.entries).toHaveLength(1);
    expect(history.entries).toHaveLength(1);

    undo();
    expect(boardTask("target")).toMatchObject({ done: false });
    expect(taskLog.entries).toHaveLength(0);
    redo();
    expect(boardTask("target")).toMatchObject({ done: true });
    expect(taskLog.entries).toHaveLength(1);
  });
});

function boardTask(id: string): Note["task"] {
  return board.notes[id]?.task ?? null;
}
