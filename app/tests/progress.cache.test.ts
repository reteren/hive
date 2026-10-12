import { afterEach, describe, expect, it } from "vitest";
import { replaceBoard, updateNote } from "../src/model/board.svelte";
import type { Note } from "../src/model/note";
import { progressSummaryForScope } from "../src/progress/progressCache.svelte";

function task(id: string, done = false): Note {
  return {
    id, type: "note", name: id, text: "", x: 0, y: 0, width: 30, height: null,
    task: { done, doneAt: done ? 1 : null },
  };
}

describe("Progress summary cache", () => {
  afterEach(() => replaceBoard([]));

  it("reuses the Board summary while notes move, then recomputes for task state", () => {
    replaceBoard([task("one", true), task("two")]);
    let importanceReads = 0;
    const importance = () => { importanceReads += 1; return null; };
    const scope = { kind: "board" } as const;
    const first = progressSummaryForScope(scope, importance);
    const readsAfterFirst = importanceReads;

    updateNote("two", { x: 120, y: 75 });
    expect(progressSummaryForScope(scope, importance)).toBe(first);
    expect(importanceReads).toBe(readsAfterFirst);

    updateNote("two", { task: { done: true, doneAt: 2 } });
    expect(progressSummaryForScope(scope, importance)).not.toBe(first);
    expect(importanceReads).toBeGreaterThan(readsAfterFirst);
  });
});
