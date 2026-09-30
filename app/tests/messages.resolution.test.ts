import { afterEach, describe, expect, it } from "vitest";
import type { Note } from "../src/model/note";
import type { Link } from "../src/model/link";
import { board, replaceBoard } from "../src/model/board.svelte";
import { links, replaceLinks } from "../src/model/links.svelte";
import { clear, history, undo, redo } from "../src/history/history.svelte";
import { importanceSoundCount, messageTextFieldState, resolveMessageContent } from "../src/messages/resolution";
import { unlink } from "../src/links/operations";
import { tryInsertModuleOnDrop, effectiveImportance } from "../src/modules/moduleActions.svelte";
import { canCreateLinkPair, effectiveLinkKind } from "../src/links/rules";
import { clippedCardRects } from "../src/messages/overhiveProtocol";

function note(id: string, type: Note["type"], fields: Partial<Note> = {}): Note {
  return { id, type, name: id, text: `Text of ${id}`, x: 0, y: 0, width: 30, height: 20, ...fields };
}
function edge(from: string, to: string, kind: Link["kind"] = "strong"): Link { return { id: `${from}-${to}`, from, to, kind, shape: "base" }; }
afterEach(() => { replaceBoard([]); replaceLinks([]); clear(); });

describe("Message recipient resolution", () => {
  it.each([true, false])("locks the field to a strong Task link in either direction (reversed=%s)", (reversed) => {
    const message = note("message", "message", { text: "Private draft" });
    const task = note("task", "note", { task: { done: false, doneAt: null }, text: "Task text\nSecond line" });
    replaceBoard([message, task]);
    const link = reversed ? edge(task.id, message.id) : edge(message.id, task.id);
    replaceLinks([link]);
    const field = messageTextFieldState(message, board.notes, [link], board.order);
    expect(field).toEqual({ value: task.text, readOnly: true, linkedTaskId: task.id });
    expect(resolveMessageContent(message, board.notes, [link], board.order)).toMatchObject({ text: field.value, targetId: task.id });
    expect(board.notes.message.text).toBe("Private draft");
  });
  it("restores the untouched Message draft on unlink, then the linked Task text on Undo", () => {
    const message = note("message", "message", { text: "Saved Message draft" });
    const task = note("task", "note", { task: { done: true, doneAt: 42 }, text: "Complete task" });
    const link = edge("task", "message");
    replaceBoard([message, task]); replaceLinks([link]); clear();
    const field = () => messageTextFieldState(board.notes.message, board.notes, Object.values(links.byId), board.order);
    expect(field()).toEqual({ value: "Complete task", readOnly: true, linkedTaskId: "task" });
    expect(unlink(link.id)).toBe(true);
    expect(field()).toEqual({ value: "Saved Message draft", readOnly: false, linkedTaskId: null });
    expect(board.notes.message.text).toBe("Saved Message draft");
    expect(history.entries).toHaveLength(1);
    undo(); expect(field()).toEqual({ value: "Complete task", readOnly: true, linkedTaskId: "task" });
    redo(); expect(field()).toEqual({ value: "Saved Message draft", readOnly: false, linkedTaskId: null });
  });
  it("uses the first linked Task in board order and follows edits of that Task", () => {
    const message = note("message", "message", { text: "Own text" });
    const first = note("first", "note", { task: { done: false, doneAt: null }, text: "First task" });
    const second = note("second", "note", { task: { done: false, doneAt: null }, text: "Second task" });
    replaceBoard([second, message, first]);
    const edges = [edge("message", "first"), edge("second", "message")];
    expect(messageTextFieldState(message, board.notes, edges, board.order)).toMatchObject({ value: "Second task", linkedTaskId: "second" });
    board.notes.second.text = "Edited second task";
    expect(messageTextFieldState(message, board.notes, edges, board.order).value).toBe("Edited second task");
    board.order = ["first", "message", "second"];
    expect(messageTextFieldState(message, board.notes, edges, board.order)).toMatchObject({ value: "First task", linkedTaskId: "first" });
  });
  it("keeps the Message editable when links are weak or point to a note without Task state", () => {
    const message = note("message", "message", { text: "Own text" });
    const ordinary = note("ordinary", "note", { text: "Ordinary note" });
    const task = note("task", "note", { task: { done: false, doneAt: null }, text: "Task" });
    const notes = { message, ordinary, task };
    for (const edges of [[], [edge("message", "task", "weak")], [edge("ordinary", "message")]]) {
      expect(messageTextFieldState(message, notes, edges)).toEqual({ value: "Own text", readOnly: false, linkedTaskId: null });
    }
  });
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
  it("allows Mark as to link strongly into Message like it can link into text notes", () => {
    const message = note("message", "message");
    const markAs = note("markas", "markas", { customMarks: [{ id: "tag", text: "Review", color: "#cf91ae" }] });
    const notes = { message, markas: markAs };
    expect(canCreateLinkPair("markas", "message", [], "strong", notes)).toBe(true);
    expect(canCreateLinkPair("markas", "message", [], "weak", notes)).toBe(true);
    expect(effectiveLinkKind("markas", "message", "weak", notes)).toBe("strong");
    expect(canCreateLinkPair("message", "markas", [], "strong", notes)).toBe(false);
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
