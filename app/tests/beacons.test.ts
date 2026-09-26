import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { BEACON_SIZE, type Note } from "../src/model/note";
import { board, replaceBoard } from "../src/model/board.svelte";
import { links, replaceLinks } from "../src/model/links.svelte";
import type { Link } from "../src/model/link";
import { linkRefusalReason } from "../src/links/rules";
import { beaconDescendants } from "../src/beacons/coverage";
import { BEACON_PALETTE, normalizeBeaconColor } from "../src/beacons/beaconPalette";
import { recolorBeacon, renameBeacon } from "../src/beacons/beaconActions.svelte";
import { creationMenu } from "../src/notes/creation.svelte";
import { createNoteKind } from "../src/notes/noteCommands";
import { grid } from "../src/board/grid.svelte";
import { clear, history, redo, undo } from "../src/history/history.svelte";
import { deleteSelection } from "../src/clipboard/commands";
import { selectOnly } from "../src/selection/selection.svelte";

const note = (id: string, type: Note["type"] = "note"): Note => ({
  id, type, name: id, text: "", x: 0, y: 0, width: type === "beacon" ? BEACON_SIZE : 30,
  height: type === "beacon" ? BEACON_SIZE : 10,
  ...(type === "beacon" ? { color: BEACON_PALETTE[0] } : {}),
});

const link = (id: string, from: string, to: string, kind: Link["kind"] = "strong"): Link =>
  ({ id, from, to, kind, shape: "base" });

beforeEach(() => {
  clear();
  replaceBoard([]);
  replaceLinks([]);
  creationMenu.origin = { x: 50, y: 40 };
  grid.snap = false;
});

afterEach(() => {
  clear();
  replaceBoard([]);
  replaceLinks([]);
});

describe("beacon creation and editing", () => {
  it("creates fixed-size, named, coloured beacons at the Q origin with one history step", () => {
    const first = createNoteKind("beacon");
    const second = createNoteKind("beacon");
    expect(board.notes[first]).toMatchObject({
      type: "beacon", name: "Beacon", text: "", x: 50 - BEACON_SIZE / 2,
      y: 40 - BEACON_SIZE / 2, width: BEACON_SIZE, height: BEACON_SIZE,
      color: BEACON_PALETTE[0], createdAt: expect.any(Number),
    });
    expect(board.notes[second]).toMatchObject({ name: "Beacon 2", color: BEACON_PALETTE[1] });
    expect(history.entries).toHaveLength(2);
    undo();
    expect(board.notes[second]).toBeUndefined();
    redo();
    expect(board.notes[second]?.name).toBe("Beacon 2");
  });

  it("renames and recolours as separate undoable actions, normalizing hex", () => {
    replaceBoard([note("a", "beacon"), note("b", "beacon")]);
    expect(renameBeacon("a", "b")).toBe(true);
    expect(board.notes.a.name).toBe("b 2");
    expect(recolorBeacon("a", "#aBc")).toBe(true);
    expect(board.notes.a.color).toBe("#aabbcc");
    expect(history.entries).toHaveLength(2);
    undo();
    expect(board.notes.a.color).toBe(BEACON_PALETTE[0]);
    undo();
    expect(board.notes.a.name).toBe("a");
    expect(normalizeBeaconColor("bad")).toBeNull();
  });

  it("deletes only the beacon and its attached links, preserving descendants and their links", () => {
    replaceBoard([note("beacon", "beacon"), note("child"), note("grandchild")]);
    replaceLinks([link("head", "beacon", "child"), link("tail", "child", "grandchild")]);
    selectOnly("beacon");
    deleteSelection();
    expect(board.notes.beacon).toBeUndefined();
    expect(board.notes.child).toBeDefined();
    expect(board.notes.grandchild).toBeDefined();
    expect(links.byId.head).toBeUndefined();
    expect(links.byId.tail).toBeDefined();
    expect(history.entries).toHaveLength(1);
    undo();
    expect(board.notes.beacon).toBeDefined();
    expect(links.byId.head).toBeDefined();
  });
});

describe("beacon link rules", () => {
  it("rejects every incoming beacon link and beacon-to-beacon links, including ME", () => {
    const notes = Object.fromEntries([note("a"), note("b", "beacon"), note("c", "beacon")].map((n) => [n.id, n]));
    expect(linkRefusalReason("a", "b", "strong", [], notes)).toMatch(/outgoing/);
    expect(linkRefusalReason("a", "me", "strong", [], notes)).toMatch(/outgoing/);
    expect(linkRefusalReason("b", "c", "strong", [], notes)).toMatch(/cannot link/);
    expect(linkRefusalReason("me", "b", "strong", [], notes)).toMatch(/cannot link/);
    expect(linkRefusalReason("b", "me", "strong", [], notes)).toMatch(/cannot link/);
  });

  it("permits outbound strong or weak links to note kinds, but never a second line per pair", () => {
    const notes = Object.fromEntries([
      note("b", "beacon"), note("n"), note("p", "pro"), note("m", "mood"),
    ].map((n) => [n.id, n]));
    for (const target of ["n", "p", "m"]) {
      expect(linkRefusalReason("b", target, "strong", [], notes)).toBeNull();
    }
    expect(linkRefusalReason("b", "n", "weak", [], notes)).toBeNull();
    expect(linkRefusalReason("me", "n", "strong", [], notes)).toBeNull();
    expect(linkRefusalReason("b", "n", "weak", [link("taken", "n", "b")], notes)).toMatch(/already/);
  });
});

describe("beacon coverage", () => {
  it("follows strong outgoing links once through cycles; weak links do not add descendants", () => {
    replaceBoard([note("b", "beacon"), note("a"), note("c"), note("d"), note("weak")]);
    replaceLinks([
      link("1", "b", "a"), link("2", "a", "c"), link("3", "c", "d"),
      link("4", "d", "a"), link("5", "c", "weak", "weak"),
    ]);
    expect(beaconDescendants("b")).toEqual(new Set(["a", "c", "d"]));
  });

  it("allows a shared descendant under two beacons and traverses from ME", () => {
    replaceBoard([note("a", "beacon"), note("b", "beacon"), note("shared"), note("child")]);
    replaceLinks([
      link("1", "a", "shared"), link("2", "b", "shared"),
      link("3", "me", "shared"), link("4", "shared", "child"),
    ]);
    const expected = new Set(["shared", "child"]);
    expect(beaconDescendants("a")).toEqual(expected);
    expect(beaconDescendants("b")).toEqual(expected);
    expect(beaconDescendants("me")).toEqual(expected);
    expect(beaconDescendants("shared")).toEqual(new Set());
  });

  it("does not count an incoming Progress scope link as part of the beacon network", () => {
    replaceBoard([note("beacon", "beacon"), note("progress", "progress"), note("child")]);
    replaceLinks([
      link("scope", "progress", "beacon"),
      link("outgoing", "beacon", "child"),
    ]);
    expect(beaconDescendants("beacon")).toEqual(new Set(["child"]));
  });
});
