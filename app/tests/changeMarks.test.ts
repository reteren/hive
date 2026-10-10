import { describe, expect, it } from "vitest";
import { externalMark, marksOnOpen, parseSeenState, seenAfterOwnSave, serializeSeenState } from "../src/changes/changeLogic";
import { nodeFingerprint, type NodeRecord } from "../src/changes/fingerprint";

const record = (id: string, extra: Record<string, unknown> = {}): NodeRecord => ({
  id, type: "note", name: id, text: "body", x: 0, y: 0, width: 25, height: null, file: `${id}.md`, ...extra,
});

describe("new / changed marks", () => {
  it("marks nothing on the first open and remembers the board as the starting point", () => {
    const result = marksOnOpen([record("a")], null);
    expect(result.marks).toEqual({});
    expect(result.seen.a).toBe(nodeFingerprint(record("a")));
  });

  it("marks nodes added or edited since this person last saw them, not ones only moved", () => {
    const seen = { a: nodeFingerprint(record("a")), b: nodeFingerprint(record("b")), c: nodeFingerprint(record("c")) };
    const now = [
      record("a", { x: 40, y: -12, zoneId: "z", file: "a 1234.md" }),
      record("b", { text: "edited by a friend" }),
      record("c", { width: 25.000000000000004 }),
      record("d"),
    ];
    expect(marksOnOpen(now, seen).marks).toEqual({ b: "changed", d: "new" });
  });

  it("ignores time-node checkpoints and a running stopwatch", () => {
    const before = record("t", { type: "time", time: { enabled: true, runtime: { lastCheckedAt: 1 }, stopwatch: { mode: "manual", running: true, startedAt: 5, elapsedMs: 10 } } });
    const after = record("t", { type: "time", time: { enabled: true, runtime: { lastCheckedAt: 999 }, stopwatch: { mode: "manual", running: true, startedAt: 7, elapsedMs: 4000 } } });
    expect(nodeFingerprint(before)).toBe(nodeFingerprint(after));
    expect(nodeFingerprint(before)).not.toBe(nodeFingerprint(record("t", { type: "time", time: { enabled: false } })));
  });

  it("own saves count as seen while marked nodes keep waiting for a look", () => {
    const seen = { a: "old-a", b: "old-b", gone: "x" };
    const next = seenAfterOwnSave([record("a", { text: "mine" }), record("b", { text: "theirs" })], seen, { b: "changed" });
    expect(next).toEqual({ a: nodeFingerprint(record("a", { text: "mine" })), b: "old-b" });
  });

  it("an outside change is new until this person has seen the node once", () => {
    expect(externalMark("a", {}, undefined)).toBe("new");
    expect(externalMark("a", { a: "f" }, undefined)).toBe("changed");
    expect(externalMark("a", { a: "f" }, "new")).toBe("new");
  });

  it("round-trips the seen state and rejects other versions", () => {
    expect(parseSeenState(serializeSeenState({ a: "1" }))).toEqual({ a: "1" });
    expect(parseSeenState('{"version":99,"seen":{}}')).toBeNull();
    expect(parseSeenState("broken")).toBeNull();
    expect(parseSeenState(null)).toBeNull();
  });
});
