import { afterEach, describe, expect, it } from "vitest";
import { board, replaceBoard } from "../src/model/board.svelte";
import { type Link } from "../src/model/link";
import { replaceLinks } from "../src/model/links.svelte";
import type { Note } from "../src/model/note";
import {
  analyzeTaskDependencies,
  canCompleteTask,
  dependencyWarnings,
} from "../src/tasks/dependencies";

function makeNote(id: string, task?: boolean, done = false, type: Note["type"] = "note"): Note {
  return {
    id,
    type,
    name: id.toUpperCase(),
    text: "",
    x: 0,
    y: 0,
    width: 30,
    height: null,
    ...(task ? { task: { done, doneAt: done ? 1 : null } } : {}),
  };
}

function strong(from: string, to: string, id = `${from}-${to}`): Link {
  return { id, from, to, kind: "strong", shape: "straight" };
}

function weak(from: string, to: string, id = `${from}-${to}`): Link {
  return { id, from, to, kind: "weak", shape: "straight" };
}

function asMap(notes: Note[]): Record<string, Note> {
  return Object.fromEntries(notes.map((note) => [note.id, note]));
}

afterEach(() => {
  replaceBoard([]);
  replaceLinks([]);
});

describe("task dependencies", () => {
  it("blocks on open direct strong task predecessors in stable board order", () => {
    const notes = [makeNote("done", true, true), makeNote("z", true), makeNote("a", true), makeNote("goal", true)];
    const status = analyzeTaskDependencies(
      "goal",
      asMap(notes),
      ["done", "z", "a", "goal"],
      [strong("a", "goal"), strong("done", "goal"), strong("z", "goal")],
    );

    expect(status.blockers).toEqual(["z", "a"]);
  });

  it("ignores weak links, non-task endpoints, missing notes, and ME", () => {
    const notes = [makeNote("target", true), makeNote("plain"), makeNote("mini", true, false, "pro")];
    const status = analyzeTaskDependencies(
      "target",
      asMap(notes),
      ["plain", "mini", "target"],
      [
        strong("plain", "target"),
        weak("mini", "target"),
        strong("missing", "target"),
        strong("me", "target"),
      ],
    );

    expect(status.blockers).toEqual([]);
    expect(analyzeTaskDependencies("plain", asMap(notes), ["plain"], [strong("mini", "plain")]))
      .toMatchObject({ blockers: [], warnings: [] });
  });

  it("only checks direct predecessors, not an earlier task in a chain", () => {
    const notes = [makeNote("a", true), makeNote("b", true), makeNote("c", true)];
    const status = analyzeTaskDependencies("c", asMap(notes), ["a", "b", "c"], [strong("a", "b"), strong("b", "c")]);

    expect(status.blockers).toEqual(["b"]);
  });

  it("marks each open predecessor in a task cycle and stops marking the cycle when a line is removed", () => {
    const notes = [makeNote("a", true), makeNote("b", true), makeNote("c", true)];
    const noteMap = asMap(notes);
    const cycle = [strong("a", "b"), strong("b", "c"), strong("c", "a")];

    expect(analyzeTaskDependencies("a", noteMap, ["a", "b", "c"], cycle))
      .toMatchObject({ blockers: ["c"], cyclePredecessors: ["c"] });
    expect(analyzeTaskDependencies("b", noteMap, ["a", "b", "c"], cycle))
      .toMatchObject({ blockers: ["a"], cyclePredecessors: ["a"] });
    expect(analyzeTaskDependencies("c", noteMap, ["a", "b", "c"], cycle))
      .toMatchObject({ blockers: ["b"], cyclePredecessors: ["b"] });

    const withoutClosingLine = cycle.slice(0, 2);
    expect(analyzeTaskDependencies("a", noteMap, ["a", "b", "c"], withoutClosingLine))
      .toMatchObject({ blockers: [], cyclePredecessors: [] });
  });

  it("keeps completed tasks done and warns when a direct predecessor is reopened", () => {
    const notes = [makeNote("a", true), makeNote("done", true, true)];
    const status = analyzeTaskDependencies("done", asMap(notes), ["a", "done"], [strong("a", "done")]);

    expect(status).toMatchObject({ blockers: ["a"], warnings: ["a"] });
    expect(analyzeTaskDependencies(
      "done",
      asMap([makeNote("a", true, true), makeNote("done", true, true)]),
      ["a", "done"],
      [strong("a", "done")],
    ).warnings).toEqual([]);
    expect(analyzeTaskDependencies("done", asMap(notes), ["a", "done"], [weak("a", "done")]).warnings)
      .toEqual([]);
  });

  it("exposes store-backed completion checks and reactive warning lookup", () => {
    const predecessor = makeNote("a", true);
    const completed = makeNote("b", true, true);
    replaceBoard([predecessor, completed]);
    replaceLinks([strong("a", "b")]);

    expect(board.order).toEqual(["a", "b"]);
    expect(canCompleteTask("b")).toEqual({ ok: false, blockers: ["a"] });
    expect(dependencyWarnings("b")).toEqual(["a"]);

    replaceLinks([weak("a", "b")]);
    expect(dependencyWarnings("b")).toEqual([]);
  });
});
