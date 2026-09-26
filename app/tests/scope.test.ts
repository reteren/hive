import { afterEach, describe, expect, it } from "vitest";
import { HistoryStack } from "../src/history/historyStack";
import { parseScope, type NodeScope } from "../src/model/nodeData";
import type { Note } from "../src/model/note";
import { replaceBoard } from "../src/model/board.svelte";
import { replaceLinks } from "../src/model/links.svelte";
import type { Link } from "../src/model/link";
import { createScopeChangeCommand } from "../src/scope/scopeChange";
import { defaultScopeForZone, effectiveScope, resolveScopeIn, scopeExistsIn } from "../src/scope/scopeLogic";
import { linkedBeaconForNote, scopeChoiceForNote, scopeForNote, scopeOptions, resolveScope } from "../src/scope/scope.svelte";

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

  it("resolves Auto under the node's current zone, or to Board when there is no zone", () => {
    expect(effectiveScope({ kind: "auto" }, "zone")).toEqual({ kind: "zone", id: "zone" });
    expect(effectiveScope({ kind: "auto" }, null)).toEqual({ kind: "board" });
    expect(resolveScopeIn({ kind: "auto" }, sources, "zone")).toEqual(new Set(["a", "b"]));
    expect(resolveScopeIn({ kind: "auto" }, sources)).toEqual(new Set(["a", "b", "c", "beacon"]));
    expect(scopeExistsIn({ kind: "auto" }, sources)).toBe(true);
    expect(parseScope({ kind: "auto" })).toEqual({ kind: "auto" });
  });

  it("lists Auto as the first choice", () => {
    expect(scopeOptions()[0]).toEqual({ scope: { kind: "auto" }, label: "Auto (under this node)" });
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

  it("stores Auto as one undoable choice and undo restores the absent default", () => {
    let savedScope: NodeScope | undefined;
    const stack = new HistoryStack();
    const change = createScopeChangeCommand(
      { id: "progress", name: "Progress", scope: savedScope },
      { kind: "auto" },
      (_id, scope) => { savedScope = scope; },
    );
    expect(change).not.toBeNull();
    stack.execute(change!);
    expect(savedScope).toEqual({ kind: "auto" });
    expect(stack.entries).toHaveLength(1);
    stack.undo();
    expect(savedScope).toBeUndefined();
  });
});

describe("beacon-linked scope", () => {
  afterEach(() => {
    replaceBoard([]);
    replaceLinks([]);
  });

  it("locks to the most recently linked beacon network and restores the stored scope when unlinked", () => {
    const progress: Note = { ...note("progress", "progress"), scope: { kind: "board" } };
    const stats = note("stats", "stats");
    const beaconA = note("beacon-a", "beacon");
    const beaconB = note("beacon-b", "beacon");
    const firstChild = note("first-child");
    const secondChild = note("second-child");
    replaceBoard([progress, stats, beaconA, beaconB, firstChild, secondChild]);
    const link = (id: string, from: string, to: string): Link => ({ id, from, to, kind: "strong", shape: "base" });
    replaceLinks([
      link("scope-a", "progress", "beacon-a"),
      link("scope-b", "progress", "beacon-b"),
      link("a-child", "beacon-a", "first-child"),
      link("b-child", "beacon-b", "second-child"),
    ]);

    expect(linkedBeaconForNote("progress")).toMatchObject({ id: "beacon-b", name: "beacon-b" });
    expect(scopeForNote(progress)).toEqual({ kind: "beacon", id: "beacon-b" });
    expect(scopeChoiceForNote(progress)).toEqual({ kind: "board" });
    expect(resolveScope(scopeForNote(progress))).toEqual(new Set(["second-child"]));

    replaceLinks([
      link("scope-a", "progress", "beacon-a"),
      link("a-child", "beacon-a", "first-child"),
    ]);
    expect(scopeForNote(progress)).toEqual({ kind: "beacon", id: "beacon-a" });
    expect(resolveScope(scopeForNote(progress))).toEqual(new Set(["first-child"]));

    replaceLinks([]);
    expect(linkedBeaconForNote("progress")).toBeNull();
    expect(scopeForNote(progress)).toEqual({ kind: "board" });
  });

  it("does not allow statistics-like scope links to ME to override Auto", () => {
    const stats = note("stats", "stats");
    replaceBoard([stats]);
    expect(linkedBeaconForNote("stats")).toBeNull();
    expect(scopeChoiceForNote(stats)).toEqual({ kind: "auto" });
  });
});
