import { describe, expect, it } from "vitest";
import { describeVersion, diffText } from "../src/info/versionChanges";

const names = { noteName: (id: string) => ({ n1: "Boss fight" } as Record<string, string>)[id], zoneName: () => "Act 1" };
const node = (extra: Record<string, unknown> = {}) => JSON.stringify({ id: "a", type: "note", name: "Plan", x: 0, y: 0, width: 30, height: null, _order: 1, file: "Plan.md", ...extra });
const version = (before: string | null, after: string | null, beforeText: string | null = "", afterText: string | null = "") =>
  ({ beforeNode: before, afterNode: after, beforeText, afterText, beforeLegacy: false });

describe("readable version changes", () => {
  it("says what happened to the node in words", () => {
    const result = describeVersion(version(node(), node({ name: "Plan B", x: 20, width: 40, scale: 1.5, task: { done: true, doneAt: 1 }, zoneId: "z" })), names);
    expect(result.lines).toEqual([
      "Renamed “Plan” → “Plan B”",
      "Moved on the board",
      "Resized 30 × auto → 40 × auto",
      "Scale 100% → 150%",
      "Moved into zone “Act 1”",
      "Made it a task and completed it",
    ]);
    expect(result.text).toBeNull();
  });

  it("describes tierlist card moves, additions and removals", () => {
    const tiers = (s: unknown[], a: unknown[]) => [{ id: "S", name: "S", cards: s }, { id: "A", name: "A", cards: a }];
    const before = node({ type: "tierlist", tiers: tiers([{ id: "c1", kind: "text", text: "Sword" }, { id: "c2", kind: "note", noteId: "n1" }], []) });
    const after = node({ type: "tierlist", tiers: tiers([{ id: "c3", kind: "text", text: "Shield" }], [{ id: "c1", kind: "text", text: "Sword" }]) });
    expect(describeVersion(version(before, after), names).lines).toEqual([
      "Added “Shield” to “S”",
      "Moved “Sword” from “S” to “A”",
      "Removed “Boss fight” from “S”",
    ]);
  });

  it("shows text changes as added and removed words, not a patch", () => {
    const result = describeVersion(version(node(), node(), "the quick brown fox", "the slow brown fox jumps"), names);
    expect(result.lines).toEqual([]);
    expect(result.text).toEqual([
      { kind: "same", text: "the " },
      { kind: "remove", text: "quick" },
      { kind: "add", text: "slow" },
      { kind: "same", text: " brown fox" },
      { kind: "add", text: " jumps" },
    ]);
  });

  it("calls a new node created, and the switch to the split format not a creation", () => {
    expect(describeVersion(version(null, node(), null, "hello"), names).lines).toEqual(["Created the node"]);
    expect(describeVersion({ ...version(null, node(), "hello", "hello"), beforeLegacy: true }, names).lines)
      .toEqual(["Project moved to the Git-friendly format"]);
  });

  it("ignores line endings and bookkeeping fields", () => {
    const result = describeVersion(version(node({ _order: 1 }), node({ _order: 5 }), "a\r\nb", "a\nb"), names);
    expect(result.lines).toEqual(["Only line endings changed in the text"]);
    expect(diffText("same", "same")).toEqual([{ kind: "same", text: "same" }]);
  });
});
