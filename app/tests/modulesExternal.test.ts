import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { board, replaceBoard } from "../src/model/board.svelte";
import { history, clear as clearHistory, undo, redo } from "../src/history/history.svelte";
import { addLink, links, replaceLinks } from "../src/model/links.svelte";
import type { Link } from "../src/model/link";
import type { Note } from "../src/model/note";
import { editing } from "../src/notes/editing.svelte";
import { creationMenu } from "../src/notes/creation.svelte";
import { createNoteKind } from "../src/notes/noteCommands";
import { noteMenuItems } from "../src/notes/noteMenu";
import "../src/modules/commands";
import {
  effectiveImportanceFor,
  effectivePurposesFor,
  linkedImportanceSourceFor,
  linkedPurposesFor,
} from "../src/modules/moduleLogic";
import { extractModuleFromNote, tryInsertModuleOnDrop } from "../src/modules/moduleActions.svelte";
import { canCreateLinkPair, linkRefusalReason } from "../src/links/rules";

function note({ id, type, ...overrides }: Partial<Note> & Pick<Note, "id" | "type">): Note {
  return {
    id,
    type,
    name: overrides.name ?? type,
    text: "",
    x: 0,
    y: 0,
    width: type === "importance" || type === "purpose" ? 14 : 30,
    height: type === "importance" || type === "purpose" ? 4 : 20,
    ...overrides,
  };
}

function link(from: string, to: string, kind: Link["kind"] = "strong", id = `${from}-${to}`): Link {
  return { id, from, to, kind, shape: "straight" };
}

function resetStores(): void {
  replaceBoard([]);
  replaceLinks([]);
  clearHistory();
  editing.noteId = null;
}

beforeEach(resetStores);
afterEach(resetStores);

describe("standalone modules", () => {
  it("resolves linked Importance from strong links in either direction", () => {
    const target = note({ id: "target", type: "note" });
    const source = note({ id: "source", type: "importance", importance: "absolute" });
    const weakSource = note({ id: "weak-source", type: "importance", importance: "basic" });
    const notes = { target, source, "weak-source": weakSource };
    const edges = [
      { from: "target", to: "source", kind: "strong" as const },
      { from: "weak-source", to: "target", kind: "weak" as const },
    ];

    expect(effectiveImportanceFor("target", notes, edges)).toBe("absolute");
    expect(linkedImportanceSourceFor("target", notes, edges)).toBe("source");
    expect(effectiveImportanceFor("target", notes, [])).toBeNull();
  });

  it("unions embedded and strong-linked Purposes in stable order without duplicates", () => {
    const target = note({ id: "target", type: "con", purposes: ["quote"] });
    const first = note({ id: "first", type: "purpose", purposes: ["concept", "quote"] });
    const weak = note({ id: "weak", type: "purpose", purposes: ["timeline"] });
    const second = note({ id: "second", type: "purpose", purposes: ["decision", "concept"] });
    const notes = { target, first, weak, second };
    const edges = [
      { from: "first", to: "target", kind: "strong" as const },
      { from: "target", to: "weak", kind: "weak" as const },
      { from: "target", to: "second", kind: "strong" as const },
    ];

    expect(effectivePurposesFor("target", notes, edges)).toEqual(["quote", "concept", "decision"]);
    expect(linkedPurposesFor("target", notes, edges)).toEqual(["concept", "quote", "decision"]);
  });

  it("enforces one embedded or strong-linked Importance source per target", () => {
    const target = note({ id: "target", type: "note" });
    const first = note({ id: "first", type: "importance", importance: "basic" });
    const second = note({ id: "second", type: "importance", importance: "important" });
    const notes = { target, first, second };

    expect(canCreateLinkPair("first", "target", [], "strong", notes)).toBe(true);
    expect(linkRefusalReason("second", "target", "strong", [link("target", "first")], notes))
      .toBe("This note already has an Importance source.");
    expect(canCreateLinkPair("second", "target", [], "strong", {
      ...notes,
      target: { ...target, importance: "medium" },
    })).toBe(false);
    expect(canCreateLinkPair("first", "second", [], "strong", notes)).toBe(false);
  });

  it("offers embedded module actions only on note, plus, and minus targets", () => {
    replaceBoard([
      note({ id: "content", type: "note" }),
      note({ id: "importance", type: "importance", importance: "basic" }),
      note({ id: "purpose", type: "purpose", purposes: ["concept"] }),
    ]);
    const moduleItems = (noteId: string) => noteMenuItems(noteId)
      .filter((item) => item.id.startsWith("module."))
      .map((item) => item.id);

    expect(moduleItems("content")).toEqual(["module.importance", "module.purpose"]);
    expect(moduleItems("importance")).toEqual([]);
    expect(moduleItems("purpose")).toEqual([]);
  });

  it("creates compact module nodes with default values and undoable ids", () => {
    creationMenu.origin = { x: 40, y: 25 };
    const importanceId = createNoteKind("importance");
    const purposeId = createNoteKind("purpose");

    expect(board.notes[importanceId]).toMatchObject({
      type: "importance",
      name: "Importance",
      text: "",
      width: 14,
      height: 4,
      importance: "basic",
      createdAt: expect.any(Number),
    });
    expect(board.notes[purposeId]).toMatchObject({
      type: "purpose",
      name: "Purpose",
      width: 14,
      height: 4,
      purposes: ["concept"],
    });
    expect(history.entries.slice(-2).map((entry) => entry.label)).toEqual(["Create importance", "Create purpose"]);

    undo();
    expect(board.notes[purposeId]).toBeUndefined();
    redo();
    expect(board.notes[purposeId]?.id).toBe(purposeId);
  });

  it("inserts an Importance module as one history operation and restores the same node and links", () => {
    const target = note({ id: "target", type: "note", name: "Target", x: 0, y: 0, width: 30, height: 20 });
    const module = note({
      id: "module",
      type: "importance",
      name: "Urgent",
      x: 50,
      y: 12,
      importance: "immediately",
    });
    const attached = link("module", "target", "strong", "attached");
    replaceBoard([target, module]);
    replaceLinks([attached]);

    expect(tryInsertModuleOnDrop("module", { x: 5, y: 5 })).toBe(true);
    expect(board.notes.target?.importance).toBe("immediately");
    expect(board.notes.module).toBeUndefined();
    expect(Object.keys(links.byId)).toEqual([]);
    expect(history.cursor).toBe(1);
    expect(history.entries[0]?.label).toBe("Insert Importance");

    undo();
    expect(board.notes.target?.importance).toBeUndefined();
    expect(board.notes.module).toMatchObject({ id: "module", name: "Urgent", x: 50, y: 12, importance: "immediately" });
    expect(links.byId.attached).toEqual(attached);
    redo();
    expect(board.notes.target?.importance).toBe("immediately");
    expect(board.notes.module).toBeUndefined();
    expect(links.byId.attached).toBeUndefined();
  });

  it("merges duplicate Purpose values on insert and restores exact arrays through Undo/Redo", () => {
    const target = note({ id: "target", type: "note", purposes: ["quote"] });
    const module = note({ id: "module", type: "purpose", purposes: ["concept", "quote"] });
    replaceBoard([target, module]);

    expect(tryInsertModuleOnDrop("module", { x: 5, y: 5 })).toBe(true);
    expect(board.notes.target?.purposes).toEqual(["quote", "concept"]);
    expect(history.entries[0]?.label).toBe("Insert Purpose");
    undo();
    expect(board.notes.target?.purposes).toEqual(["quote"]);
    expect(board.notes.module?.purposes).toEqual(["concept", "quote"]);
    redo();
    expect(board.notes.target?.purposes).toEqual(["quote", "concept"]);
  });

  it("extracts embedded Importance to a stable linked module in one reversible step", () => {
    const target = note({ id: "target", type: "pro", name: "Target", importance: "medium" });
    replaceBoard([target]);

    expect(extractModuleFromNote("target", "importance", "medium", { x: 48, y: 22 })).toBe(true);
    expect(board.notes.target?.importance).toBeNull();
    expect(history.entries[0]?.label).toBe("Extract Importance");
    const module = Object.values(board.notes).find((candidate) => candidate.type === "importance");
    expect(module).toMatchObject({ importance: "medium", text: "", createdAt: expect.any(Number) });
    const createdLink = Object.values(links.byId)[0];
    expect(createdLink).toMatchObject({ from: module?.id, to: "target", kind: "strong" });

    undo();
    expect(board.notes.target?.importance).toBe("medium");
    expect(Object.values(board.notes)).toEqual([target]);
    expect(Object.keys(links.byId)).toEqual([]);
    redo();
    expect(board.notes[module!.id]?.importance).toBe("medium");
    expect(links.byId[createdLink.id]?.from).toBe(module?.id);
  });
});
