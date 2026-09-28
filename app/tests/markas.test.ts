import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { HistoryStack } from "../src/history/historyStack";
import { history, clear, undo, redo } from "../src/history/history.svelte";
import { addNote, board, replaceBoard } from "../src/model/board.svelte";
import { addLink, links, replaceLinks } from "../src/model/links.svelte";
import type { Link } from "../src/model/link";
import type { CustomMark } from "../src/model/nodeData";
import type { Note } from "../src/model/note";
import { extractModuleFromNote, tryInsertModuleOnDrop } from "../src/modules/moduleActions.svelte";
import {
  createMarkAsPatchCommand,
  customMarkGradientFor,
  effectiveCustomMarkFrameFor,
  effectiveCustomMarksFor,
  mergeCustomMarks,
  validateCustomMark,
} from "../src/markas/markasLogic";

function note(overrides: Partial<Note> = {}): Note {
  return {
    id: "note-1",
    type: "note",
    name: "Idea",
    text: "",
    x: 0,
    y: 0,
    width: 30,
    height: 20,
    ...overrides,
  };
}

function link(from: string, to: string, kind: Link["kind"] = "strong", id = `${from}-${to}`): Link {
  return { id, from, to, kind, shape: "base" };
}

function writeMarks(target: Note, noteId: string, patch: { customMarks?: CustomMark[]; customMarkFrame?: boolean }): void {
  if (target.id !== noteId) return;
  if ("customMarks" in patch) {
    if (patch.customMarks === undefined) delete target.customMarks;
    else target.customMarks = patch.customMarks.map((mark) => ({ ...mark }));
  }
  if ("customMarkFrame" in patch) {
    if (patch.customMarkFrame === undefined) delete target.customMarkFrame;
    else target.customMarkFrame = patch.customMarkFrame;
  }
}

function reset(): void {
  replaceBoard([]);
  replaceLinks([]);
  clear();
}

beforeEach(reset);
afterEach(reset);

describe("Mark as tag rules", () => {
  it("validates non-empty names up to 30 characters and six-digit hex colours", () => {
    expect(validateCustomMark("  Research  ", "#Aa12f0")).toEqual({
      ok: true,
      value: { text: "Research", color: "#aa12f0" },
    });
    expect(validateCustomMark("", "#abcdef")).toEqual({ ok: false, error: "Enter a tag name." });
    expect(validateCustomMark("x".repeat(31), "#abcdef")).toEqual({
      ok: false,
      error: "Tag names can be up to 30 characters.",
    });
    expect(validateCustomMark("Label", "red")).toEqual({ ok: false, error: "Choose a valid hex colour." });
  });

  it("merges tags by exact text and colour, retaining the first id and order", () => {
    const first = { id: "first", text: "Focus", color: "#AABBCC" };
    const duplicate = { id: "duplicate", text: "Focus", color: "#aabbcc" };
    const otherColor = { id: "other-color", text: "Focus", color: "#112233" };
    const otherText = { id: "other-text", text: "focus", color: "#aabbcc" };

    expect(mergeCustomMarks([first], [duplicate, otherColor, otherText])).toEqual([
      first,
      otherColor,
      otherText,
    ]);
  });

  it("applies only outgoing strong Mark as links to content notes", () => {
    const mark: CustomMark = { id: "m1", text: "Review", color: "#cf91ae" };
    const target = note({ id: "target", customMarks: [{ id: "local", text: "Local", color: "#70b7b4" }] });
    const source = note({ id: "source", type: "markas", customMarks: [mark], customMarkFrame: true });
    const notes = { target, source };

    expect(effectiveCustomMarksFor("target", notes, [link("source", "target")])).toEqual([
      target.customMarks![0],
      mark,
    ]);
    expect(effectiveCustomMarksFor("target", notes, [link("source", "target", "weak")])).toEqual(target.customMarks);
    expect(effectiveCustomMarksFor("target", notes, [link("target", "source")])).toEqual(target.customMarks);
    expect(effectiveCustomMarkFrameFor("target", notes, [link("source", "target")])).toBe(true);
    expect(effectiveCustomMarkFrameFor("target", notes, [link("source", "target", "weak")])).toBe(false);
  });

  it("records tag and frame edits as one reversible command", () => {
    const current = note();
    const stack = new HistoryStack();
    const mark = { id: "m1", text: "Review", color: "#cf91ae" };
    const command = createMarkAsPatchCommand(
      current,
      { customMarks: [mark], customMarkFrame: true },
      (id, patch) => writeMarks(current, id, patch),
      "Add Mark as tag",
    );
    if (!command) throw new Error("Expected a Mark as command.");

    stack.execute(command);
    expect(current.customMarks).toEqual([mark]);
    expect(current.customMarkFrame).toBe(true);
    stack.undo();
    expect(Object.hasOwn(current, "customMarks")).toBe(false);
    expect(Object.hasOwn(current, "customMarkFrame")).toBe(false);
    stack.redo();
    expect(current.customMarks).toEqual([mark]);
    expect(current.customMarkFrame).toBe(true);
  });

  it("builds the frame gradient from only the configured tag colours", () => {
    expect(customMarkGradientFor(["#e58b83", "#78a8d2"])).toBe(
      "linear-gradient(90deg, #e58b83 0%, #78a8d2 25%, #e58b83 50%, #78a8d2 75%, #e58b83 100%)",
    );
    expect(customMarkGradientFor(["#e58b83"])).toBe("linear-gradient(90deg, #e58b83, #e58b83)");
  });
});

describe("Mark as module operations", () => {
  it("inserts tags into a note, merges duplicates, and restores both nodes on Undo", () => {
    const existing = { id: "kept", text: "Focus", color: "#aabbcc" };
    const added = { id: "added", text: "Urgent", color: "#e58b83" };
    const target = note({ id: "target", customMarks: [existing] });
    const module = note({
      id: "module",
      type: "markas",
      name: "Mark as",
      x: 60,
      width: 14,
      height: null,
      customMarks: [
        { id: "dupe", text: "Focus", color: "#AABBCC" },
        added,
      ],
      customMarkFrame: true,
    });
    replaceBoard([target, module]);

    expect(tryInsertModuleOnDrop(module.id, { x: 4, y: 4 })).toBe(true);
    expect(board.notes.target?.customMarks).toEqual([existing, added]);
    expect(board.notes.target?.customMarkFrame).toBe(true);
    expect(board.notes.module).toBeUndefined();
    expect(history.entries).toHaveLength(1);

    undo();
    expect(board.notes.target?.customMarks).toEqual([existing]);
    expect(board.notes.target?.customMarkFrame).toBeUndefined();
    expect(board.notes.module?.customMarks).toHaveLength(2);
    redo();
    expect(board.notes.target?.customMarks).toEqual([existing, added]);
    expect(board.notes.module).toBeUndefined();
  });

  it("pulls a tag into a linked Mark as node and Undo restores the note exactly", () => {
    const mark = { id: "m1", text: "Review", color: "#cf91ae" };
    const target = note({ id: "target", customMarks: [mark], customMarkFrame: true });
    addNote(target);

    expect(extractModuleFromNote("target", "markas", "m1", { x: 100, y: 100 })).toBe(true);
    const module = Object.values(board.notes).find((item) => item.type === "markas");
    expect(module?.customMarks).toEqual([mark]);
    expect(module?.customMarkFrame).toBe(true);
    expect(board.notes.target?.customMarks).toEqual([]);
    expect(board.notes.target?.customMarkFrame).toBe(false);
    expect(Object.values(links.byId)).toEqual([expect.objectContaining({ from: module?.id, to: "target", kind: "strong" })]);
    expect(history.entries).toHaveLength(1);

    undo();
    expect(board.notes.target?.customMarks).toEqual([mark]);
    expect(board.notes.target?.customMarkFrame).toBe(true);
    expect(Object.values(board.notes).filter((item) => item.type === "markas")).toHaveLength(0);
    expect(Object.values(links.byId)).toHaveLength(0);
    redo();
    expect(board.notes.target?.customMarks).toEqual([]);
    expect(Object.values(board.notes).filter((item) => item.type === "markas")).toHaveLength(1);
  });

  it("merges matching Mark as nodes and rewires strong targets in one Undo step", () => {
    const duplicate = { id: "duplicate", text: "Focus", color: "#aabbcc" };
    const targetMark = { id: "target-mark", text: "Focus", color: "#AABBCC" };
    const extra = { id: "extra", text: "Decision", color: "#91bd81" };
    const target = note({ id: "target", type: "markas", customMarks: [targetMark] });
    const source = note({ id: "source", type: "markas", name: "Source", x: 60, width: 14, customMarks: [duplicate, extra], customMarkFrame: true });
    const linkedNote = note({ id: "linked", x: 120 });
    replaceBoard([target, source, linkedNote]);
    addLink(link("source", "linked", "strong", "source-link"));

    expect(tryInsertModuleOnDrop("source", { x: 3, y: 3 })).toBe(true);
    expect(board.notes.target?.customMarks).toEqual([targetMark, extra]);
    expect(board.notes.target?.customMarkFrame).toBe(true);
    expect(board.notes.source).toBeUndefined();
    expect(links.byId["source-link"]).toEqual(expect.objectContaining({ from: "target", to: "linked" }));
    expect(Object.values(links.byId)).toEqual([expect.objectContaining({ from: "target", to: "linked" })]);
    expect(history.entries).toHaveLength(1);

    undo();
    expect(board.notes.source?.customMarks).toEqual([duplicate, extra]);
    expect(board.notes.target?.customMarks).toEqual([targetMark]);
    expect(board.notes.target?.customMarkFrame).toBeUndefined();
    expect(links.byId["source-link"]).toEqual(expect.objectContaining({ from: "source", to: "linked" }));
  });
});

describe("Mark as frame placement", () => {
  const marks: CustomMark[] = [{ id: "m1", text: "urgent", color: "#e58b83" }];
  const notes = {
    mk: { id: "mk", type: "markas", customMarks: marks, customMarkFrame: true },
    linked: { id: "linked", type: "note" },
    alone: { id: "alone", type: "note" },
  } as const;
  const edges = [{ from: "mk", to: "linked", kind: "strong" as const }];

  it("never frames the Mark as node itself, only the note it is linked to", () => {
    expect(effectiveCustomMarkFrameFor("mk", notes, edges)).toBe(false);
    expect(effectiveCustomMarkFrameFor("linked", notes, edges)).toBe(true);
    expect(effectiveCustomMarkFrameFor("alone", notes, edges)).toBe(false);
  });

  it("keeps the Frame setting on the Mark as node while it has no tags, framing once tags exist", () => {
    const empty = { ...notes, mk: { ...notes.mk, customMarks: [] } };
    expect(effectiveCustomMarkFrameFor("linked", empty, edges)).toBe(false);
    expect(effectiveCustomMarkFrameFor("linked", notes, edges)).toBe(true);
  });
});
