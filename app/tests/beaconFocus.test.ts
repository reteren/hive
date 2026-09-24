import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { addNote, board, removeNote } from "../src/model/board.svelte";
import { links } from "../src/model/links.svelte";
import type { Note } from "../src/model/note";
import { selection } from "../src/selection/selection.svelte";
import { beaconState, resetBeaconViewState } from "../src/beacons/beaconState.svelte";
import { allBeacons, isDimmed, selectBeaconGroups, setFocused, toggleSelectedFocus } from "../src/beacons/focus.svelte";
import { isMarked, markSelected, nextMarkedBeacon } from "../src/beacons/marks.svelte";

function note(id: string, type: Note["type"] = "note"): Note {
  return { id, type, name: id, text: "", x: 0, y: 0, width: 10, height: 10, createdAt: 0 };
}

function strong(id: string, from: string, to: string): void {
  links.byId[id] = { id, from, to, kind: "strong", shape: "base" };
}

beforeEach(() => {
  board.notes = {};
  board.order = [];
  links.byId = {};
  selection.ids = [];
  selection.primaryId = null;
  resetBeaconViewState();
});
afterEach(() => resetBeaconViewState());

describe("beacon focus", () => {
  it("unions every focused beacon's descendants and dims unrelated nodes", () => {
    for (const [id, kind] of [["a", "beacon"], ["b", "beacon"], ["child", "note"], ["grandchild", "note"], ["other", "note"], ["unrelated", "note"]] as const) addNote(note(id, kind));
    strong("a-child", "a", "child");
    strong("child-grandchild", "child", "grandchild");
    strong("b-other", "b", "other");
    setFocused("a", true);
    setFocused("b", true);

    expect(["a", "b", "child", "grandchild", "other"].every((id) => !isDimmed(id))).toBe(true);
    expect(isDimmed("unrelated")).toBe(true);
    expect(isDimmed("me")).toBe(true);
  });

  it("keeps Ctrl+G and menu checkbox state in sync, and selects the whole group", () => {
    addNote(note("a", "beacon"));
    addNote(note("child"));
    strong("a-child", "a", "child");
    selection.ids = ["a"];
    toggleSelectedFocus();
    expect(beaconState.focused).toEqual(["a"]);
    expect(allBeacons()).toEqual(["me", "a"]);
    setFocused("me", true);
    expect(beaconState.focused).toEqual(["a", "me"]);
    toggleSelectedFocus();
    expect(beaconState.focused).toEqual(["me"]);
    selection.ids = ["a"];
    selectBeaconGroups();
    expect(selection.ids).toEqual(["a", "child"]);
  });

  it("drops a selection when focus makes it non-interactive", () => {
    addNote(note("a", "beacon"));
    addNote(note("outside"));
    selection.ids = ["a", "outside"];
    selection.primaryId = "outside";
    setFocused("a", true);
    expect(selection.ids).toEqual(["a"]);
    expect(selection.primaryId).toBe("a");
  });

  it("does not use ME when an ordinary note is selected", () => {
    addNote(note("ordinary"));
    selection.ids = ["ordinary"];
    toggleSelectedFocus();
    markSelected(false);
    expect(beaconState.focused).toEqual([]);
    expect(beaconState.marked).toEqual([]);
  });
});

describe("beacon marks", () => {
  it("replaces on M, adds or removes on Ctrl+M, and cycles from the first", () => {
    addNote(note("a", "beacon"));
    addNote(note("b", "beacon"));
    selection.ids = ["a"];
    markSelected(false);
    selection.ids = ["b"];
    markSelected(true);
    expect(beaconState.marked).toEqual(["a", "b"]);
    expect([nextMarkedBeacon(), nextMarkedBeacon(), nextMarkedBeacon()]).toEqual(["a", "b", "a"]);
    expect(isMarked("b")).toBe(true);
    markSelected(true);
    expect(beaconState.marked).toEqual(["a"]);
    markSelected(false);
    expect(beaconState.marked).toEqual(["b"]);
  });

  it("skips deleted marks and falls back to ME when all are gone", () => {
    addNote(note("a", "beacon"));
    addNote(note("b", "beacon"));
    beaconState.marked = ["a", "b"];
    expect(nextMarkedBeacon()).toBe("a");
    removeNote("a");
    expect(nextMarkedBeacon()).toBe("b");
    expect(beaconState.marked).toEqual(["b"]);
    removeNote("b");
    expect(nextMarkedBeacon()).toBe("me");
    expect(beaconState.marked).toEqual([]);
  });
});
