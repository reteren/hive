import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { board, replaceBoard } from "../src/model/board.svelte";
import { history, clear as clearHistory, undo, redo } from "../src/history/history.svelte";
import { addLink, links, replaceLinks } from "../src/model/links.svelte";
import type { Link } from "../src/model/link";
import type { Note } from "../src/model/note";
import { editing } from "../src/notes/editing.svelte";
import { creationMenu } from "../src/notes/creation.svelte";
import { grid } from "../src/board/grid.svelte";
import { createNoteKind } from "../src/notes/noteCommands";
import { noteMenuItems } from "../src/notes/noteMenu";
import "../src/modules/commands";
import {
  effectiveImportanceFor,
  effectivePurposesFor,
  importanceMenuLabel,
  linkedImportanceSourceFor,
  linkedPurposesFor,
} from "../src/modules/moduleLogic";
import {
  effectiveImportance,
  extractModuleFromNote,
  isLinkedImportance,
  makeImportanceLocal,
  setImportance,
  setLinkedImportance,
  tryInsertModuleOnDrop,
  togglePurpose,
} from "../src/modules/moduleActions.svelte";
import { canCreateLinkPair, effectiveLinkKind, linkRefusalReason } from "../src/links/rules";
import { closeModulePicker, modulePicker, toggleModulePicker } from "../src/modules/pickerState.svelte";

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
  return { id, from, to, kind, shape: "base" };
}

function resetStores(): void {
  replaceBoard([]);
  replaceLinks([]);
  clearHistory();
  editing.noteId = null;
}

beforeEach(resetStores);
afterEach(() => {
  resetStores();
  vi.useRealTimers();
});

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
    expect(effectiveImportanceFor("target", {
      ...notes,
      target: { ...target, importance: "medium" },
    }, edges)).toBe("absolute");
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

  it("keeps a standalone Purpose picker open through multiple selections", () => {
    replaceBoard([note({ id: "purpose", type: "purpose", purposes: ["quote"] })]);
    try {
      toggleModulePicker("purpose", "purpose");
      togglePurpose("purpose", "concept");
      togglePurpose("purpose", "decision");

      expect(board.notes.purpose?.purposes).toEqual(["quote", "concept", "decision"]);
      expect(modulePicker).toMatchObject({ noteId: "purpose", kind: "purpose" });
      expect(history.cursor).toBe(2);
    } finally {
      closeModulePicker();
    }
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

  it("accepts a weak-tool request as a strong module link in either direction", () => {
    const content = note({ id: "content", type: "note" });
    const importance = note({ id: "importance", type: "importance", importance: "basic" });
    const purpose = note({ id: "purpose", type: "purpose", purposes: ["concept"] });
    const notes = { content, importance, purpose };

    for (const moduleId of ["importance", "purpose"]) {
      expect(linkRefusalReason(moduleId, "content", "weak", [], notes)).toBeNull();
      expect(linkRefusalReason("content", moduleId, "weak", [], notes)).toBeNull();
      expect(canCreateLinkPair(moduleId, "content", [], "weak", notes)).toBe(true);
      expect(effectiveLinkKind(moduleId, "content", "weak", notes)).toBe("strong");
      expect(effectiveLinkKind("content", moduleId, "weak", notes)).toBe("strong");
    }
    expect(canCreateLinkPair("purpose", "content", [], "strong", notes)).toBe(true);
    expect(linkRefusalReason("importance", "content", "weak", [], {
      ...notes,
      content: { ...content, importance: "medium" },
    })).toBe("This note already has an Importance source.");
  });

  it("edits a linked Importance source or makes just this target local, with exact history", () => {
    const target = note({ id: "target", type: "note", name: "Target" });
    const other = note({ id: "other", type: "con", name: "Other" });
    const module = note({ id: "module", type: "importance", name: "Shared priority", importance: "basic" });
    const targetLink = link("module", "target", "strong", "target-link");
    const otherLink = link("other", "module", "strong", "other-link");
    replaceBoard([target, other, module]);
    replaceLinks([targetLink, otherLink]);

    expect(isLinkedImportance("target")).toBe(true);
    expect(importanceMenuLabel(target, isLinkedImportance(target.id))).toBe("Change Importance");

    vi.useFakeTimers();
    setImportance("target", "important");
    expect(board.notes.target?.importance).toBeUndefined();
    expect(board.notes.module?.importance).toBe("basic");
    expect(history.cursor).toBe(0);
    vi.runOnlyPendingTimers();

    expect(setLinkedImportance("target", "medium")).toBe(true);
    expect(board.notes.module?.importance).toBe("medium");
    expect(effectiveImportance("target")).toBe("medium");
    expect(effectiveImportance("other")).toBe("medium");
    expect(history.entries.at(-1)?.label).toBe("Importance: medium");
    undo();
    expect(board.notes.module?.importance).toBe("basic");
    redo();
    expect(board.notes.module?.importance).toBe("medium");

    expect(makeImportanceLocal("target", "immediately")).toBe(true);
    expect(board.notes.target?.importance).toBe("immediately");
    expect(links.byId["target-link"]).toBeUndefined();
    expect(links.byId["other-link"]).toEqual(otherLink);
    expect(effectiveImportance("target")).toBe("immediately");
    expect(effectiveImportance("other")).toBe("medium");
    expect(history.entries.at(-1)?.label).toBe("Make Importance Local");

    undo();
    expect(board.notes.target?.importance).toBeUndefined();
    expect(links.byId["target-link"]).toEqual(targetLink);
    expect(effectiveImportance("target")).toBe("medium");
    redo();
    expect(board.notes.target?.importance).toBe("immediately");
    expect(links.byId["target-link"]).toBeUndefined();
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

    expect(moduleItems("content")).toEqual(["module.importance", "module.purpose", "module.mood"]);
    expect(moduleItems("importance")).toEqual([]);
    expect(moduleItems("purpose")).toEqual([]);

    replaceLinks([link("importance", "content")]);
    const importanceItem = noteMenuItems("content").find((item) => item.id === "module.importance");
    expect(importanceItem?.label("content")).toBe("Change Importance");
    expect(moduleItems("content")).not.toContain("module.removeImportance");
  });

  it("creates compact modules with empty Purpose and Mood selection", () => {
    creationMenu.origin = { x: 40, y: 25 };
    const importanceId = createNoteKind("importance");
    const purposeId = createNoteKind("purpose");
    const moodId = createNoteKind("mood");

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
      height: null,
      purposes: [],
    });
    expect(board.notes[moodId]).toMatchObject({ type: "mood", height: null, moods: [] });
    expect(history.entries.slice(-3).map((entry) => entry.label)).toEqual(["Create importance", "Create purpose", "Create mood"]);

    undo();
    expect(board.notes[moodId]).toBeUndefined();
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
    const originalOrder = [...board.order];

    expect(tryInsertModuleOnDrop("module", { x: 5, y: 5 })).toBe(true);
    expect(board.notes.target?.importance).toBe("immediately");
    expect(board.notes.module).toBeUndefined();
    expect(Object.keys(links.byId)).toEqual([]);
    expect(history.cursor).toBe(1);
    expect(history.entries[0]?.label).toBe("Insert Importance");

    undo();
    expect(board.order).toEqual(originalOrder);
    expect(board.notes.target?.importance).toBeUndefined();
    expect(board.notes.module).toMatchObject({ id: "module", name: "Urgent", x: 50, y: 12, importance: "immediately" });
    expect(links.byId.attached).toEqual(attached);
    redo();
    expect(board.order).toEqual(["target"]);
    expect(board.notes.target?.importance).toBe("immediately");
    expect(board.notes.module).toBeUndefined();
    expect(links.byId.attached).toBeUndefined();
  });

  it("keeps a shared module and its other target link when inserting it into one target", () => {
    const firstTarget = note({ id: "first-target", type: "note", name: "First", height: 20 });
    const secondTarget = note({ id: "second-target", type: "con", name: "Second", x: 40, height: 20 });
    const module = note({
      id: "shared",
      type: "importance",
      name: "Shared",
      x: 80,
      importance: "important",
    });
    const firstLink = link("shared", "first-target", "strong", "first-link");
    const secondLink = link("second-target", "shared", "strong", "second-link");
    replaceBoard([firstTarget, secondTarget, module]);
    replaceLinks([firstLink, secondLink]);

    expect(tryInsertModuleOnDrop("shared", { x: 5, y: 5 })).toBe(true);
    expect(board.notes["first-target"]?.importance).toBe("important");
    expect(board.notes.shared?.importance).toBe("important");
    expect(links.byId["first-link"]).toBeUndefined();
    expect(links.byId["second-link"]).toEqual(secondLink);
    expect(effectiveImportance("second-target")).toBe("important");
    expect(history.cursor).toBe(1);

    undo();
    expect(board.notes["first-target"]?.importance).toBeUndefined();
    expect(board.notes.shared?.x).toBe(80);
    expect(links.byId["first-link"]).toEqual(firstLink);
    expect(links.byId["second-link"]).toEqual(secondLink);
    redo();
    expect(board.notes.shared).toBeDefined();
    expect(links.byId["second-link"]).toEqual(secondLink);
    expect(links.byId["first-link"]).toBeUndefined();
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

  it("moves an extracted module to the nearest free spot with a two-unit gap", () => {
    grid.snap = false;
    grid.step = 10;
    const target = note({ id: "target", type: "pro", name: "Target", importance: "medium" });
    const blocker = note({ id: "blocker", type: "note", x: 41, y: 20, width: 14, height: 4 });
    replaceBoard([target, blocker]);

    expect(extractModuleFromNote("target", "importance", "medium", { x: 48, y: 22 })).toBe(true);
    const module = Object.values(board.notes).find((candidate) => candidate.type === "importance");
    expect(module).toMatchObject({ x: 57, y: 20, width: 14, height: 4 });
    expect(module!.x < blocker.x + blocker.width && module!.x + module!.width > blocker.x &&
      module!.y < blocker.y + blocker.height! && module!.y + module!.height! > blocker.y).toBe(false);
    expect(history.entries).toHaveLength(1);
  });
});
