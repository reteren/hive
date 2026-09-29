import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { board, replaceBoard } from "../src/model/board.svelte";
import type { Note } from "../src/model/note";
import type { ShownMessage } from "../src/time/types";
import { defaultMessageData, parseMessageData } from "../src/messages/data";
import { setMessageSettings, setMessageText } from "../src/messages/actions.svelte";
import { dismissMessage, messageQueue, pushMessage } from "../src/messages/messageQueue.svelte";
import { goToMessage } from "../src/messages/navigation";
import { messageCardPresentation, overhiveMessageCards, presentedMessage, visibleMessages } from "../src/messages/presentation";
import { camera } from "../src/board/camera.svelte";
import { selection, selectOnly } from "../src/selection/selection.svelte";
import { clear, history, redo, undo } from "../src/history/history.svelte";
import { noteBounds } from "../src/notes/layout.svelte";

vi.mock("../src/messages/sound", () => ({ playMessageSound: vi.fn(async () => true) }));
import { playMessageSound } from "../src/messages/sound";

function note(id: string, type: Note["type"], fields: Partial<Note> = {}): Note {
  return { id, type, name: id, text: "", x: 100, y: 50, width: 30, height: null, ...fields };
}
function payload(fields: Partial<Omit<ShownMessage, "id" | "shownAt">> = {}): Omit<ShownMessage, "id" | "shownAt"> {
  return { timeId: "time", messageId: "message", text: "First line\nSecond line", dueAt: Date.now() - 60_000, overlate: true, sound: false, ...fields };
}
beforeEach(() => {
  vi.useFakeTimers(); vi.setSystemTime(new Date("2026-09-28T12:00:00Z"));
  replaceBoard([note("time", "time"), note("message", "message"), note("editing", "note")]);
  selectOnly("editing"); camera.x = 2; camera.y = 3; camera.zoom = 1;
  clear(); vi.mocked(playMessageSound).mockClear();
});
afterEach(() => {
  for (const card of [...messageQueue.items]) dismissMessage(card.id);
  vi.unstubAllGlobals(); vi.useRealTimers(); replaceBoard([]); clear();
});

describe("Message settings and text", () => {
  it("defaults to silent persistent cards and validates saved settings without sharing objects", () => {
    expect(defaultMessageData()).toEqual({ sound: false, overhive: false });
    expect(defaultMessageData()).not.toBe(defaultMessageData());
    expect(parseMessageData({ sound: true, autoHideSeconds: 2.5 })).toEqual({ sound: true, overhive: false });
    expect(parseMessageData({ sound: true, overhive: true, autoHideSeconds: -1 })).toEqual({ sound: true, overhive: true });
    for (const value of [null, [], {}, { sound: "true", autoHideSeconds: null }, { sound: true, overhive: "yes" }]) expect(parseMessageData(value)).toBeUndefined();
  });
  it("records one settings edit, restores missing defaults exactly and ignores no-op/invalid edits", () => {
    expect(setMessageSettings("message", { overhive: false })).toBe(false);
    expect(setMessageSettings("message", { sound: undefined })).toBe(false);
    expect(setMessageSettings("editing", { sound: true })).toBe(false);
    expect(history.entries).toHaveLength(0);
    expect(setMessageSettings("message", { sound: true })).toBe(true);
    expect(history.entries).toHaveLength(1);
    expect(board.notes.message.message).toEqual({ sound: true, overhive: false });
    undo(); expect(board.notes.message.message).toBeUndefined();
    redo(); expect(board.notes.message.message?.sound).toBe(true);
    setMessageSettings("message", { overhive: true });
    expect(history.entries).toHaveLength(2);
    undo(); expect(board.notes.message.message?.overhive).toBe(false);
  });
  it("saves multiline text immediately but merges one edit session into one Undo step", () => {
    const group = Symbol();
    setMessageText("message", "First", group); setMessageText("message", "First\nSecond", group);
    expect(board.notes.message.text).toBe("First\nSecond"); expect(history.entries).toHaveLength(1);
    undo(); expect(board.notes.message.text).toBe("");
    redo(); expect(board.notes.message.text).toBe("First\nSecond");
    setMessageText("message", "Other", Symbol()); expect(history.entries).toHaveLength(2);
    undo(); expect(board.notes.message.text).toBe("First\nSecond");
  });
});

describe("reminder queue", () => {
  it("keeps cards until dismissed and shows the newest four before exposing overflow", () => {
    const ids = Array.from({ length: 6 }, (_, index) => pushMessage(payload({ text: String(index) })));
    expect(new Set(ids).size).toBe(6);
    expect(messageQueue.items.map((card) => card.text)).toEqual(["5", "4", "3", "2", "1", "0"]);
    expect(visibleMessages(messageQueue.items).map((card) => card.text)).toEqual(["5", "4", "3", "2"]);
    expect(visibleMessages(messageQueue.items, true)).toHaveLength(6);
    vi.advanceTimersByTime(60 * 60 * 1000);
    expect(messageQueue.items).toHaveLength(6);
    dismissMessage(ids[5]); expect(visibleMessages(messageQueue.items)[0].text).toBe("4");
    expect(history.entries).toHaveLength(0);
  });
  it("keeps Overhive reminders in the Hive stack and mirrors the shared card id", () => {
    const id = pushMessage(payload({ messageId: null, overhive: true }));
    const localCard = visibleMessages(messageQueue.items)[0];
    const overlayCard = overhiveMessageCards(messageQueue.items, board.notes, []).find((card) => card.id === id);
    expect(localCard.id).toBe(id);
    expect(overlayCard).toMatchObject({ id, overhive: true });

    dismissMessage(id);
    expect(visibleMessages(messageQueue.items).some((card) => card.id === id)).toBe(false);
    expect(overhiveMessageCards(messageQueue.items, board.notes, [])).toEqual([]);
  });
  it("resolves reminder note links and Mark as frame colours for both card views", () => {
    const mark = { id: "urgent", text: "Urgent", color: "#e58b83" };
    const message = note("message", "message", { customMarks: [], customMarkFrame: false, message: { sound: false, overhive: true } });
    const markAs = note("mark-as", "markas", { customMarks: [mark], customMarkFrame: true });
    const beacon = note("beacon-1", "beacon", { name: "Beacon" });
    const card = { ...payload({ messageId: message.id, targetId: message.id, overhive: true, text: "1123 [Beacon](hive://note/beacon-1)" }), id: "shown", shownAt: 0 };
    const presentation = messageCardPresentation(card, { message, "mark-as": markAs, "beacon-1": beacon }, [
      { from: markAs.id, to: message.id, kind: "strong" },
    ]);

    expect(presentation).toMatchObject({ title: "message", linkedNotes: { "beacon-1": "Beacon" }, customMarkFrameColors: [mark.color] });
    expect(presentation.overhive).toBe(true);
  });
  it("ignores old expiration and plays the importance's tone count only when Sound is on", () => {
    const oldPayload = { ...payload({ sound: true, importance: "absolute" }), autoHideSeconds: 2 };
    const id = pushMessage(oldPayload);
    pushMessage(payload({ importance: "important" }));
    expect(playMessageSound).toHaveBeenCalledExactlyOnceWith(5);
    vi.advanceTimersByTime(24 * 60 * 60 * 1000);
    expect(messageQueue.items.some((card) => card.id === id)).toBe(true);
    expect(messageQueue.items.find((card) => card.id === id)).not.toHaveProperty("autoHideSeconds");
    expect(vi.getTimerCount()).toBe(0);
    dismissMessage(id); expect(messageQueue.items).toHaveLength(1);
  });
  it("never changes focus, camera or selection on delivery even while an editor is active", () => {
    const focus = vi.fn();
    const editor = { tagName: "TEXTAREA", focus };
    vi.stubGlobal("document", { activeElement: editor });
    pushMessage(payload());
    expect(document.activeElement).toBe(editor); expect(focus).not.toHaveBeenCalled();
    expect(selection.ids).toEqual(["editing"]); expect(camera).toMatchObject({ x: 2, y: 3 });
    expect(history.entries).toHaveLength(0);
  });
  it("navigates and selects only after explicit Go to, and dismisses that card", () => {
    const id = pushMessage(payload());
    expect(goToMessage(id)).toBe(true);
    const bounds = noteBounds(board.notes.message);
    expect(camera).toMatchObject({ x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 });
    expect(selection.ids).toEqual(["message"]); expect(messageQueue.items).toHaveLength(0);
    expect(history.entries).toHaveLength(1);
  });
  it("uses the Time node for fallback cards and leaves unavailable-target cards intact", () => {
    const fallback = pushMessage(payload({ messageId: null }));
    expect(goToMessage(fallback)).toBe(true); expect(selection.ids).toEqual(["time"]);
    const missing = pushMessage(payload({ messageId: "removed" }));
    expect(goToMessage(missing)).toBe(false); expect(messageQueue.items[0].id).toBe(missing);
  });
  it("explicitly navigates to a linked Task instead of the Message and retains other cards", () => {
    const kept = pushMessage(payload());
    const taskCard = pushMessage(payload({ targetId: "editing", overhive: true }));
    expect(goToMessage(taskCard)).toBe(true);
    expect(selection.ids).toEqual(["editing"]);
    expect(messageQueue.items.map((card) => card.id)).toEqual([kept]);
  });
  it("updates the header and desktop visibility of existing cards when the Message controls change", () => {
    const id = pushMessage(payload());
    const card = messageQueue.items.find((item) => item.id === id)!;
    board.notes.message.headerHidden = true;
    setMessageSettings("message", { overhive: true });
    expect(presentedMessage(card, board.notes)).toMatchObject({ headerHidden: true, overhive: true });
    board.notes.message.headerHidden = false;
    undo();
    expect(presentedMessage(card, board.notes)).toMatchObject({ headerHidden: false, overhive: false });
    expect(messageQueue.items).toHaveLength(1);
  });
  it("reads embedded Message visibility settings from any host node that owns message data", () => {
    const host = note("embedded-host", "note", {
      headerHidden: true,
      message: { sound: true, overhive: true },
    });
    const card = { ...payload({ messageId: host.id, headerHidden: false, overhive: false }), id: "embedded", shownAt: 0 };
    expect(presentedMessage(card, { ...board.notes, [host.id]: host })).toMatchObject({
      headerHidden: true,
      overhive: true,
    });
  });
});
