import { afterEach, describe, expect, it } from "vitest";
import type { Note } from "../src/model/note";
import type { Link } from "../src/model/link";
import { board, replaceBoard } from "../src/model/board.svelte";
import { replaceLinks } from "../src/model/links.svelte";
import { clear, history, undo, redo } from "../src/history/history.svelte";
import { importanceSoundCount, resolveMessageContent } from "../src/messages/resolution";
import { tryInsertModuleOnDrop, effectiveImportance } from "../src/modules/moduleActions.svelte";
import { canCreateLinkPair } from "../src/links/rules";
import { clippedCardRects } from "../src/messages/overhiveProtocol";

function note(id: string, type: Note["type"], fields: Partial<Note> = {}): Note {
  return { id, type, name: id, text: `Text of ${id}`, x: 0, y: 0, width: 30, height: 20, ...fields };
}
function edge(from: string, to: string, kind: Link["kind"] = "strong"): Link { return { id: `${from}-${to}`, from, to, kind, shape: "base" }; }
afterEach(() => { replaceBoard([]); replaceLinks([]); clear(); });

describe("Message recipient resolution", () => {
  it.each([true, false])("uses Task text and navigation in either strong direction (reversed=%s)", (reversed) => {
    const message = note("message", "message", { headerHidden: true, message: { sound: true, overhive: true } });
    const task = note("task", "note", { task: { done: false, doneAt: null }, text: "Task\nbody" });
    const link = reversed ? edge(task.id, message.id) : edge(message.id, task.id);
    expect(resolveMessageContent(message, { message, task }, [link])).toMatchObject({ text: "Task\nbody", targetId: "task", headerHidden: true, sound: true, overhive: true });
    expect(resolveMessageContent(message, { message, task }, [{ ...link, kind: "weak" }])).toMatchObject({ text: message.text, targetId: message.id });
  });
  it("chooses the first Task by board order and combines Message and Task importance by highest level", () => {
    const message = note("message", "message", { importance: "medium" });
    const a = note("a", "note", { task: { done: false, doneAt: null }, importance: "basic" });
    const b = note("b", "note", { task: { done: true, doneAt: 5 } });
    const importance = note("importance", "importance", { importance: "absolute" });
    const edges = [edge("a", "message"), edge("message", "b"), edge("importance", "b")];
    expect(resolveMessageContent(message, { message, a, b, importance }, edges, ["a", "b", "message"]).importance).toBe("medium");
    expect(resolveMessageContent(message, { message, a, b, importance }, edges, ["b", "a", "message"])).toMatchObject({ targetId: "b", importance: "absolute" });
  });
  it("accepts a standalone Importance link and insert/extract mechanics without enabling other module kinds", () => {
    const message = note("message", "message");
    const importance = note("importance", "importance", { x: 100, importance: "important" });
    const purpose = note("purpose", "purpose", { x: 150, purposes: ["quote"] });
    const notes = { message, importance, purpose };
    expect(canCreateLinkPair("importance", "message", [], "strong", notes)).toBe(true);
    expect(canCreateLinkPair("purpose", "message", [], "strong", notes)).toBe(false);
    expect(resolveMessageContent(message, notes, [edge("importance", "message")]).importance).toBe("important");
    replaceBoard([message, importance, purpose]); clear();
    expect(tryInsertModuleOnDrop("purpose", { x: 10, y: 10 })).toBe(false);
    expect(tryInsertModuleOnDrop("importance", { x: 10, y: 10 })).toBe(true);
    expect(effectiveImportance("message")).toBe("important");
    expect(board.notes.importance).toBeUndefined(); expect(history.entries).toHaveLength(1);
    undo(); expect(board.notes.importance).toBeDefined(); expect(board.notes.message.importance).toBeUndefined();
    redo(); expect(board.notes.message.importance).toBe("important");
  });
  it("maps the five importance levels to exactly one through five sounds", () => {
    expect([null, "basic", "medium", "important", "immediately", "absolute"].map((level) => importanceSoundCount(level as Note["importance"]))).toEqual([1, 1, 2, 3, 4, 5]);
  });
});

it("desktop card regions exclude transparent gaps, zero-scale frames and off-screen parts", () => {
  expect(clippedCardRects([
    { x: -10, y: 20, width: 30, height: 40 }, { x: 50, y: 5, width: 0, height: 30 },
    { x: 90, y: 90, width: 50, height: 50 }, { x: NaN, y: 0, width: 20, height: 30 },
  ], 100, 100)).toEqual([{ x: 0, y: 20, width: 20, height: 40 }, { x: 90, y: 90, width: 10, height: 10 }]);
});
