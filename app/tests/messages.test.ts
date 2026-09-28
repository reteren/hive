import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { board, replaceBoard } from "../src/model/board.svelte";
import type { Note } from "../src/model/note";
import type { ShownMessage } from "../src/time/types";
import { defaultMessageData, parseAutoHideInput, parseMessageData } from "../src/messages/data";
import { setMessageSettings, setMessageText } from "../src/messages/actions.svelte";
import { dismissMessage, messageQueue, pushMessage } from "../src/messages/messageQueue.svelte";
import { goToMessage } from "../src/messages/navigation";
import { visibleMessages } from "../src/messages/presentation";
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
  return { timeId: "time", messageId: "message", text: "First line\nSecond line", dueAt: Date.now() - 60_000, overlate: true, sound: false, autoHideSeconds: null, ...fields };
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
    expect(defaultMessageData()).toEqual({ sound: false, autoHideSeconds: null });
    expect(defaultMessageData()).not.toBe(defaultMessageData());
    expect(parseMessageData({ sound: true, autoHideSeconds: 2.5 })).toEqual({ sound: true, autoHideSeconds: 2.5 });
    for (const value of [null, [], {}, { sound: "true", autoHideSeconds: null }, { sound: true, autoHideSeconds: -1 }, { sound: false, autoHideSeconds: Infinity }]) expect(parseMessageData(value)).toBeUndefined();
    expect(parseAutoHideInput(" ")).toEqual({ seconds: null, error: null });
    expect(parseAutoHideInput("15")).toEqual({ seconds: 15, error: null });
    for (const value of ["0", "-5", "no", "Infinity"]) expect(parseAutoHideInput(value).error).toBeTruthy();
  });
  it("records one settings edit, restores missing defaults exactly and ignores no-op/invalid edits", () => {
    expect(setMessageSettings("message", { autoHideSeconds: null })).toBe(false);
    expect(setMessageSettings("message", { autoHideSeconds: 0 })).toBe(false);
    expect(setMessageSettings("editing", { sound: true })).toBe(false);
    expect(history.entries).toHaveLength(0);
    expect(setMessageSettings("message", { sound: true })).toBe(true);
    expect(history.entries).toHaveLength(1);
    expect(board.notes.message.message).toEqual({ sound: true, autoHideSeconds: null });
    undo(); expect(board.notes.message.message).toBeUndefined();
    redo(); expect(board.notes.message.message?.sound).toBe(true);
    setMessageSettings("message", { autoHideSeconds: 10 });
    expect(history.entries).toHaveLength(2);
    undo(); expect(board.notes.message.message?.autoHideSeconds).toBeNull();
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
  it("expires cards independently, cancels dismissal timers and only plays opted-in sound", () => {
    const short = pushMessage(payload({ autoHideSeconds: 2, sound: true }));
    const long = pushMessage(payload({ autoHideSeconds: 5 }));
    const permanent = pushMessage(payload());
    expect(playMessageSound).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(2000);
    expect(messageQueue.items.some((card) => card.id === short)).toBe(false);
    dismissMessage(long); vi.advanceTimersByTime(3000);
    expect(messageQueue.items.map((card) => card.id)).toEqual([permanent]);
    expect(vi.getTimerCount()).toBe(0);
  });
  it("does not overflow native timer limits for very long durations", () => {
    const id = pushMessage(payload({ autoHideSeconds: 3_000_000 }));
    vi.advanceTimersByTime(2_147_483_647); expect(messageQueue.items[0].id).toBe(id);
    vi.advanceTimersByTime(3_000_000_000 - 2_147_483_647); expect(messageQueue.items).toHaveLength(0);
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
});
