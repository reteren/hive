import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { addNote, board, removeNote } from "../src/model/board.svelte";
import { links } from "../src/model/links.svelte";
import type { Note } from "../src/model/note";
import { selection } from "../src/selection/selection.svelte";
import { beaconState, resetBeaconViewState } from "../src/beacons/beaconState.svelte";
import { allBeacons, isDimmed, selectBeaconGroups, setFocused, toggleSelectedFocus } from "../src/beacons/focus.svelte";
import { beaconDescendants } from "../src/beacons/coverage";
import { isMarked, nextMarkedBeacon, toggleSelectedMarks } from "../src/beacons/marks.svelte";
import "../src/beacons/focusCommands";
import "../src/tasks/taskActions.svelte";
import { getCommands } from "../src/commands/registry.svelte";
import { noteMenuItems } from "../src/notes/noteMenu";
import { clear as clearHistory, history, redo, undo } from "../src/history/history.svelte";

function note(id: string, type: Note["type"] = "note"): Note {
  return { id, type, name: id, text: "", x: 0, y: 0, width: 10, height: 10, createdAt: 0 };
}

function strong(id: string, from: string, to: string): void {
  links.byId[id] = { id, from, to, kind: "strong", shape: "base" };
}

beforeEach(() => {
  clearHistory();
  board.notes = {};
  board.order = [];
  links.byId = {};
  selection.ids = [];
  selection.primaryId = null;
  resetBeaconViewState();
});
afterEach(() => {
  clearHistory();
  resetBeaconViewState();
});

describe("beacon focus", () => {
  it("marks with M, toggles marks with Ctrl+M and offers keyed actions in the note menu", () => {
    addNote(note("a", "beacon"));
    addNote(note("ordinary"));
    const markCommands = getCommands().filter((command) => command.id.startsWith("beacons.") && /mark/i.test(command.label));
    expect(markCommands.map((command) => [command.label, command.keys])).toEqual([
      ["Mark selected beacon", ["KeyM"]],
      ["Add or remove beacon mark", ["Ctrl+KeyM"]],
    ]);
    expect(getCommands().find((command) => command.id === "beacons.toggleMark")).toBeUndefined();

    const beaconItems = noteMenuItems("a");
    expect(beaconItems.map((item) => item.id)).not.toContain("task.toggleFlag");
    expect(beaconItems.find((item) => item.id === "beacons.toggleMark")?.label("a")).toBe("Mark (Ctrl+M)");
    expect(beaconItems.find((item) => item.id === "beacons.toggleFocus")?.label("a")).toBe("Focus (Ctrl+G)");
    expect(noteMenuItems("ordinary").map((item) => item.id)).toContain("task.toggleFlag");
  });

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
    expect(history.entries.map(({ label }) => label)).toEqual(["Select 2 objects"]);
    undo();
    expect(selection.ids).toEqual(["a"]);
    redo();
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
    toggleSelectedMarks();
    expect(beaconState.focused).toEqual([]);
    expect(beaconState.marked).toEqual([]);
  });

  it("includes a standalone module whose strong targets are all in the beacon network", () => {
    for (const [id, kind] of [["a", "beacon"], ["inside", "note"], ["module", "importance"]] as const) addNote(note(id, kind));
    strong("a-inside", "a", "inside");
    strong("module-inside", "module", "inside");
    setFocused("a", true);
    expect(beaconDescendants("a")).toEqual(new Set(["inside", "module"]));
    expect(isDimmed("module")).toBe(false);
    selection.ids = ["a"];
    selectBeaconGroups();
    expect(selection.ids).toEqual(["a", "inside", "module"]);
  });

  it("leaves a module dimmed and unselected when it also feeds outside the network", () => {
    for (const [id, kind] of [["a", "beacon"], ["inside", "note"], ["outside", "note"], ["module", "purpose"]] as const) addNote(note(id, kind));
    strong("a-inside", "a", "inside");
    strong("module-inside", "module", "inside");
    strong("module-outside", "module", "outside");
    setFocused("a", true);
    expect(beaconDescendants("a")).toEqual(new Set(["inside"]));
    expect(isDimmed("module")).toBe(true);
    selection.ids = ["a"];
    selectBeaconGroups();
    expect(selection.ids).toEqual(["a", "inside"]);
  });

  it("includes module chains into the network, but does not include isolated module cycles", () => {
    for (const [id, kind] of [
      ["a", "beacon"], ["inside", "note"], ["first", "mood"], ["second", "importance"],
      ["third", "purpose"], ["cycle-a", "mood"], ["cycle-b", "purpose"],
    ] as const) addNote(note(id, kind));
    strong("a-inside", "a", "inside");
    strong("first-second", "first", "second");
    strong("second-third", "second", "third");
    strong("third-inside", "third", "inside");
    strong("cycle-a-b", "cycle-a", "cycle-b");
    strong("cycle-b-a", "cycle-b", "cycle-a");
    setFocused("a", true);
    expect(beaconDescendants("a")).toEqual(new Set(["inside", "first", "second", "third"]));
    expect(isDimmed("cycle-a")).toBe(true);
    selection.ids = ["a"];
    selectBeaconGroups();
    expect(new Set(selection.ids)).toEqual(new Set(["a", "inside", "first", "second", "third"]));
  });
});

describe("beacon marks", () => {
  it("toggles the selected beacons on Ctrl+M and cycles from the first", () => {
    addNote(note("a", "beacon"));
    addNote(note("b", "beacon"));
    selection.ids = ["a", "b"];
    toggleSelectedMarks();
    expect(beaconState.marked).toEqual(["a", "b"]);
    expect([nextMarkedBeacon(), nextMarkedBeacon(), nextMarkedBeacon()]).toEqual(["a", "b", "a"]);
    expect(isMarked("b")).toBe(true);
    selection.ids = ["b"];
    toggleSelectedMarks();
    expect(beaconState.marked).toEqual(["a"]);
    toggleSelectedMarks();
    expect(beaconState.marked).toEqual(["a", "b"]);
    selection.ids = ["a"];
    toggleSelectedMarks();
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
