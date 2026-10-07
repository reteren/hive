import { describe, expect, it } from "vitest";
import { mergeBoardDocuments } from "../src/project/boardMerge";

const note = (id: string, x = 0) => ({ id, name: id, file: `${id}.md`, x, y: 0, width: 30 });

describe("merging a pulled board into the open window", () => {
  const base = { version: 3, notes: [note("a"), note("b")], links: [], calculators: {}, beaconMarks: [], projectCounters: { appMs: 1 } };

  it("keeps nodes added on both sides", () => {
    const mine = { ...base, notes: [...base.notes, note("mine")] };
    const theirs = { ...base, notes: [...base.notes, note("friend")] };
    const { document, conflicts } = mergeBoardDocuments(base, mine, theirs);
    expect((document.notes as { id: string }[]).map((n) => n.id)).toEqual(["a", "b", "friend", "mine"]);
    expect(conflicts).toEqual([]);
  });

  it("takes what only the pull changed and keeps what only this window changed", () => {
    const mine = { ...base, notes: [note("a", 50), note("b")] };
    const theirs = { ...base, notes: [note("a"), note("b", 70)] };
    const { document } = mergeBoardDocuments(base, mine, theirs);
    expect((document.notes as { x: number }[]).map((n) => n.x)).toEqual([50, 70]);
  });

  it("deletes what one side deleted and the other left alone; keeps an edit over a delete", () => {
    const mine = { ...base, notes: [note("a", 9)] };
    const theirs = { ...base, notes: [note("b")] };
    const { document } = mergeBoardDocuments(base, mine, theirs);
    expect((document.notes as { id: string }[]).map((n) => n.id)).toEqual(["a"]);
  });

  it("keeps this window's version when both edited the same node", () => {
    const mine = { ...base, notes: [note("a", 1), note("b")] };
    const theirs = { ...base, notes: [note("a", 2), note("b")] };
    const { document, conflicts } = mergeBoardDocuments(base, mine, theirs);
    expect((document.notes as { x: number }[])[0]!.x).toBe(1);
    expect(conflicts).toEqual(["notes a"]);
  });

  it("never takes someone else's stopwatch and merges calculators and marks by key", () => {
    const mine = { ...base, projectCounters: { appMs: 5 }, calculators: { Bank: { total: 1 } }, beaconMarks: ["x"] };
    const theirs = { ...base, projectCounters: { appMs: 900 }, calculators: { Shop: { total: 2 } }, beaconMarks: ["y"] };
    const { document } = mergeBoardDocuments(base, mine, theirs);
    expect(document.projectCounters).toEqual({ appMs: 5 });
    expect(document.calculators).toEqual({ Shop: { total: 2 }, Bank: { total: 1 } });
    expect(document.beaconMarks).toEqual(["y", "x"]);
  });

  it("treats objects with the same fields in another order as unchanged", () => {
    const reordered = { ...base, notes: [{ width: 30, y: 0, x: 0, file: "a.md", name: "a", id: "a" }, note("b")] };
    const theirs = { ...base, notes: [note("a"), note("b", 3)] };
    const { document, conflicts } = mergeBoardDocuments(base, reordered, theirs);
    expect(conflicts).toEqual([]);
    expect((document.notes as { x: number }[])[1]!.x).toBe(3);
  });
});
