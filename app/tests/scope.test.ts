import { describe, expect, it } from "vitest";
import { HistoryStack } from "../src/history/historyStack";
import type { NodeScope } from "../src/model/nodeData";
import type { Note } from "../src/model/note";
import { createScopeChangeCommand } from "../src/scope/scopeChange";
import { defaultScopeForZone, resolveScopeIn, scopeExistsIn } from "../src/scope/scopeLogic";

function note(id: string, type: Note["type"] = "note"): Note {
  return { id, type, name: id, text: "", x: 0, y: 0, width: 30, height: null };
}

const notes: Record<string, Note> = {
  a: note("a"),
  b: note("b"),
  c: note("c"),
  beacon: note("beacon", "beacon"),
};

const sources = {
  notes,
  zones: { zone: { id: "zone" } },
  zoneMembers: (id: string) => id === "zone" ? ["a", "b", "a", "missing", "me"] : [],
  beaconDescendants: (id: string) => id === "beacon" ? new Set(["b", "c", "missing"]) : new Set<string>(),
};

describe("scope resolution", () => {
  it("resolves Board to all existing notes", () => {
    expect(resolveScopeIn({ kind: "board" }, sources)).toEqual(new Set(["a", "b", "c", "beacon"]));
  });

  it("resolves a zone to distinct current members and excludes non-note objects", () => {
    expect(resolveScopeIn({ kind: "zone", id: "zone" }, sources)).toEqual(new Set(["a", "b"]));
  });

  it("uses the beacon network and returns empty for a missing beacon or zone", () => {
    expect(resolveScopeIn({ kind: "beacon", id: "beacon" }, sources)).toEqual(new Set(["b", "c"]));
    expect(resolveScopeIn({ kind: "beacon", id: "gone" }, sources)).toEqual(new Set());
    expect(resolveScopeIn({ kind: "zone", id: "gone" }, sources)).toEqual(new Set());
    expect(scopeExistsIn({ kind: "beacon", id: "gone" }, sources)).toBe(false);
    expect(scopeExistsIn({ kind: "zone", id: "gone" }, sources)).toBe(false);
  });

  it("includes the permanent ME beacon as a valid scope", () => {
    expect(scopeExistsIn({ kind: "beacon", id: "me" }, sources)).toBe(true);
    expect(resolveScopeIn({ kind: "beacon", id: "me" }, sources)).toEqual(new Set());
  });

  it("defaults lazily to the current zone or Board", () => {
    expect(defaultScopeForZone("zone")).toEqual({ kind: "zone", id: "zone" });
    expect(defaultScopeForZone(null)).toEqual({ kind: "board" });
  });
});

describe("scope change history", () => {
  it("records one reversible explicit choice and restores an implicit scope on Undo", () => {
    let savedScope: NodeScope | undefined;
    const stack = new HistoryStack();
    const change = createScopeChangeCommand(
      { id: "progress", name: "Progress", scope: savedScope },
      { kind: "zone", id: "zone" },
      (_id, scope) => { savedScope = scope; },
    );
    expect(change).not.toBeNull();
    stack.execute(change!);
    expect(savedScope).toEqual({ kind: "zone", id: "zone" });
    expect(stack.entries).toHaveLength(1);

    stack.undo();
    expect(savedScope).toBeUndefined();
    stack.redo();
    expect(savedScope).toEqual({ kind: "zone", id: "zone" });
  });
});
