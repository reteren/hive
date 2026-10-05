import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { BEACON_PALETTE } from "../src/beacons/beaconPalette";
import { BEACON_SIZE, type Note } from "../src/model/note";
import { board, replaceBoard } from "../src/model/board.svelte";
import { replaceLinks } from "../src/model/links.svelte";
import { clear, redo, undo } from "../src/history/history.svelte";
import { selection } from "../src/selection/selection.svelte";
import { objectColor } from "../src/links/colors";
import { mergeLoadedNotes, parseProjectIndex, serializeProjectIndex } from "../src/project/index";
import {
  closeNoteColorPopover,
  noteColorPopover,
  noteColorStyle,
  noteColorTargets,
  openNoteColorPopover,
  paintNotes,
  previewNoteColor,
  resetNoteColorPopover,
} from "../src/notes/noteColor.svelte";
import { noteMenuItems } from "../src/notes/noteMenu";

const noteMenuVisible = (id: string): string[] =>
  noteMenuItems(id).map((item) => item.id).filter((itemId) => itemId === "notes.color" || itemId === "notes.accentColor");

const note = (id: string, type: Note["type"] = "note"): Note => ({
  id, type, name: id, text: "", x: 0, y: 0, width: type === "beacon" ? BEACON_SIZE : 30,
  height: type === "beacon" ? BEACON_SIZE : 10,
  ...(type === "beacon" ? { color: BEACON_PALETTE[0] } : {}),
});

beforeEach(() => {
  clear();
  replaceBoard([note("a"), note("b", "pro"), note("c", "list"), note("beacon", "beacon"), note("img", "image")]);
  replaceLinks([]);
  selection.ids = [];
});

afterEach(() => {
  noteColorPopover.current = null;
  selection.ids = [];
  clear();
  replaceBoard([]);
});

describe("node colours", () => {
  it("paints the main and accent colour of any node as separate Undo steps", () => {
    expect(paintNotes(["c"], "color", "#AbC")).toBe(true);
    expect(paintNotes(["c"], "accentColor", "#102030")).toBe(true);
    expect(board.notes.c).toMatchObject({ color: "#aabbcc", accentColor: "#102030" });
    undo();
    expect(board.notes.c.accentColor).toBeUndefined();
    expect(board.notes.c.color).toBe("#aabbcc");
    undo();
    expect(board.notes.c.color).toBeUndefined();
    redo();
    expect(board.notes.c.color).toBe("#aabbcc");
  });

  it("tints the node's lines with its main colour, like a beacon", () => {
    const grey = objectColor("a");
    paintNotes(["a"], "color", "#ff0000");
    expect(objectColor("a")).toBe("#ff0000");
    paintNotes(["a"], "color", null);
    expect(objectColor("a")).toBe(grey);
  });

  it("leaves beacons and images to their own editors", () => {
    expect(paintNotes(["beacon", "img"], "color", "#ff0000")).toBe(false);
    expect(board.notes.beacon.color).toBe(BEACON_PALETTE[0]);
    expect(noteMenuVisible("beacon")).toEqual([]);
    expect(noteMenuVisible("a")).toEqual(["notes.color", "notes.accentColor"]);
  });

  it("paints the whole selection when the clicked node is selected", () => {
    selection.ids = ["a", "b", "beacon"];
    expect(noteColorTargets("a")).toEqual(["a", "b"]);
    expect(noteColorTargets("c")).toEqual(["c"]);
  });

  it("previews live, then lands one Undo step on Done; Cancel restores", () => {
    selection.ids = ["a", "b"];
    openNoteColorPopover("a", "accentColor", { x: 0, y: 0 }, 1);
    previewNoteColor("#111111");
    previewNoteColor("#eeeeee");
    expect(board.notes.b.accentColor).toBe("#eeeeee");
    closeNoteColorPopover(true);
    expect(board.notes.a.accentColor).toBe("#eeeeee");
    undo();
    expect(board.notes.a.accentColor).toBeUndefined();
    expect(board.notes.b.accentColor).toBeUndefined();

    openNoteColorPopover("a", "color", { x: 0, y: 0 }, 1);
    previewNoteColor("#123456");
    closeNoteColorPopover(false);
    expect(board.notes.a.color).toBeUndefined();
  });

  it("Reset returns the theme greys", () => {
    paintNotes(["a"], "color", "#123456");
    openNoteColorPopover("a", "color", { x: 0, y: 0 }, 1);
    resetNoteColorPopover();
    expect(board.notes.a.color).toBeUndefined();
    undo();
    expect(board.notes.a.color).toBe("#123456");
  });

  it("switches to dark text on light colours", () => {
    expect(noteColorStyle({ type: "note" })).toEqual({});
    expect(noteColorStyle({ type: "note", color: "#202040", accentColor: "#f4f0c0" })).toEqual({
      "--note-frame": "#202040",
      "--note-body": "#f4f0c0",
      "--text": "#1f1f1f",
      "--text-dim": "#4a4a4a",
    });
    expect(noteColorStyle({ type: "note", color: "#ffe066" })["--note-header-text"]).toBe("#1f1f1f");
  });

  it("saves both colours with the project", () => {
    const painted: Note = { ...note("a"), color: "#aa3300", accentColor: "#331100" };
    const project = parseProjectIndex(serializeProjectIndex([painted]));
    const indexed = project.notes[0]!;
    expect(indexed).toMatchObject({ color: "#aa3300", accentColor: "#331100" });
    const [loaded] = mergeLoadedNotes(project, [{
      id: indexed.id, name: indexed.name, file: indexed.file, text: "",
      x: indexed.x, y: indexed.y, width: indexed.width, height: indexed.height,
    }]);
    expect(loaded).toMatchObject({ color: "#aa3300", accentColor: "#331100" });
  });
});
