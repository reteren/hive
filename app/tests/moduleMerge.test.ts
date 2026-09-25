import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { board, replaceBoard } from "../src/model/board.svelte";
import { clear as clearHistory, history, redo, undo } from "../src/history/history.svelte";
import { links, replaceLinks } from "../src/model/links.svelte";
import type { Link } from "../src/model/link";
import type { Note } from "../src/model/note";
import { planModuleMerge } from "../src/modules/moduleMerge";
import { tryInsertModuleOnDrop, updateModuleDropPreview, moduleDropPreview } from "../src/modules/moduleActions.svelte";

function node(id: string, type: Note["type"], x: number, patch: Partial<Note> = {}): Note {
  return { id, type, name: id, text: "", x, y: 0, width: type === "note" ? 30 : 14,
    height: type === "purpose" || type === "mood" ? null : 4, ...patch };
}

function edge(id: string, from: string, to: string, kind: Link["kind"] = "strong"): Link {
  return { id, from, to, kind, shape: "base" };
}

beforeEach(() => { replaceBoard([]); replaceLinks([]); clearHistory(); });
afterEach(() => { replaceBoard([]); replaceLinks([]); clearHistory(); });

describe("standalone module merge", () => {
  it("keeps target mood order, unions unique source moods, rewires strong links, and skips duplicate pairs", () => {
    const target = node("target", "mood", 0, { moods: ["happiness", "sadness"] });
    const source = node("source", "mood", 30, { moods: ["sadness", "guilt"] });
    const a = node("a", "note", 70);
    const b = node("b", "note", 110);
    const old = [edge("target-a", "target", "a"), edge("source-a", "source", "a"),
      edge("source-b", "b", "source"), edge("source-weak", "source", "b", "weak")];
    const result = planModuleMerge(source, target, old, { target, source, a, b });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.plan.values).toEqual(["happiness", "sadness", "guilt"]);
    expect(result.plan.removedLinks.map((link) => link.id)).toEqual(["source-a", "source-b", "source-weak"]);
    expect(result.plan.addedLinks).toEqual([edge("source-b", "b", "target")]);
  });

  it("merges Purpose nodes as one undoable command while keeping linked note effects", () => {
    const target = node("target", "purpose", 0, { purposes: ["quote"] });
    const source = node("source", "purpose", 30, { purposes: ["quote", "timeline"] });
    const content = node("content", "note", 70, { purposes: [] });
    replaceBoard([target, source, content]);
    replaceLinks([edge("source-content", "source", "content")]);

    updateModuleDropPreview("source", { x: 5, y: 2 });
    expect(moduleDropPreview).toMatchObject({ targetId: "target", allowed: true });
    expect(tryInsertModuleOnDrop("source", { x: 5, y: 2 })).toBe(true);
    expect(board.notes.source).toBeUndefined();
    expect(board.notes.target?.purposes).toEqual(["quote", "timeline"]);
    expect(links.byId["source-content"]).toMatchObject({ from: "target", to: "content" });
    expect(history.entries).toHaveLength(1);
    expect(history.entries[0]?.label).toBe("Merge Purpose");

    undo();
    expect(board.notes.source?.purposes).toEqual(["quote", "timeline"]);
    expect(board.notes.target?.purposes).toEqual(["quote"]);
    expect(links.byId["source-content"]).toMatchObject({ from: "source", to: "content" });
    redo();
    expect(board.notes.source).toBeUndefined();
    expect(links.byId["source-content"]).toMatchObject({ from: "target", to: "content" });
  });

  it("does not merge Importance nodes", () => {
    replaceBoard([node("target", "importance", 0, { importance: "basic" }),
      node("source", "importance", 30, { importance: "medium" })]);
    expect(tryInsertModuleOnDrop("source", { x: 5, y: 2 })).toBe(false);
    expect(board.notes.source?.importance).toBe("medium");
    expect(history.entries).toHaveLength(0);
  });

  it("refuses a merge that would create an invalid module-to-module strong link", () => {
    const target = node("target", "mood", 0);
    const source = node("source", "mood", 30);
    const other = node("other", "purpose", 70);
    const result = planModuleMerge(source, target, [edge("legacy", "source", "other")], { target, source, other });
    expect(result).toMatchObject({ ok: false, reason: "Module nodes link only to notes, pluses, or minuses." });
  });
});
