import { describe, expect, it } from "vitest";
import type { ImportanceLevel, Note } from "../src/model/note";
import { summarizeProgress } from "../src/progress/progress";

function taskNote(id: string, done: boolean, importance?: ImportanceLevel): Note {
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
    ...(importance ? { importance } : {}),
  };
}

describe("weighted Progress", () => {
  it("reports 50% for one of two equal tasks", () => {
    const notes = { done: taskNote("done", true), open: taskNote("open", false) };
    const summary = summarizeProgress(Object.keys(notes), notes, () => null);
    expect(summary).toEqual({ taskCount: 2, doneWeight: 1, totalWeight: 2, percent: 50 });
  });

  it("uses effective Importance weights from one through five", () => {
    const levels: ImportanceLevel[] = ["basic", "medium", "important", "immediately", "absolute"];
    const notes = Object.fromEntries(levels.map((level, index) => [level, taskNote(level, index === 1, level)]));
    const summary = summarizeProgress(levels, notes, (id) => id as ImportanceLevel);
    expect(summary).toEqual({ taskCount: 5, doneWeight: 2, totalWeight: 15, percent: 13 });
  });

  it("counts a task once even when a scope reaches it by multiple paths", () => {
    const notes = { one: taskNote("one", true), two: taskNote("two", false) };
    const summary = summarizeProgress(["one", "two", "one", "one"], notes, () => null);
    expect(summary).toEqual({ taskCount: 2, doneWeight: 1, totalWeight: 2, percent: 50 });
  });

  it("returns an empty result without dividing by zero", () => {
    expect(summarizeProgress([], {}, () => null)).toEqual({
      taskCount: 0,
      doneWeight: 0,
      totalWeight: 0,
      percent: null,
    });
  });
});
