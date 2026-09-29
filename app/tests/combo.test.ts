import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { clear as clearHistory, execute, history, redo, undo } from "../src/history/history.svelte";
import { board, replaceBoard } from "../src/model/board.svelte";
import { links, replaceLinks } from "../src/model/links.svelte";
import type { Link } from "../src/model/link";
import type { Note } from "../src/model/note";
import { serializeNotes, parseNotesPayload } from "../src/clipboard/payload";
import { parseProjectIndex, mergeLoadedNotes, serializeProjectIndex } from "../src/project/index";
import { sanitizeArchiveEntries } from "../src/archive/serialization";
import { sanitizeTrashEntries } from "../src/trash/serialization";
import { extractComboPart, comboInsertCommand } from "../src/combo/actions.svelte";
import { copyTimeForHost, parseEmbedSections, copyEmbedSections } from "../src/combo/data";
import { canInsertCombo, comboSectionsFor, nextSectionState, planComboInsertion, sectionExpanded } from "../src/combo/logic";
import { linkedMessagesForTime, taskMessageHostsForTime } from "../src/time/runtimeLogic";

const timeData: NonNullable<Note["time"]> = {
  schedule: { kind: "interval", minutes: 30, mode: "calendar", repeat: true },
  enabled: true,
  view: "stopwatch",
};
const messageData = { sound: true, overhive: true };

function makeNote(id: string, type: Note["type"] = "note", patch: Partial<Note> = {}): Note {
  return { id, type, name: id, text: `${id} text`, x: 0, y: 0, width: 30, height: null, ...patch };
}

function edge(id: string, from: string, to: string): Link {
  return { id, from, to, kind: "strong", shape: "base" };
}

function merged(host: Note, source: Note): Note {
  const plan = planComboInsertion(host, source);
  if (!plan) throw new Error("Expected compatible combo parts.");
  const { hostFields, ...plannedHost } = plan;
  return { ...host, ...hostFields, ...plannedHost };
}

beforeEach(() => {
  clearHistory();
  replaceBoard([]);
  replaceLinks([]);
});

afterEach(() => {
  clearHistory();
  replaceBoard([]);
  replaceLinks([]);
});

describe("Time + Message + Note combinations", () => {
  it("normalizes Time + Message to the same Message-host shape in either insertion order", () => {
    const message = makeNote("message", "message", { text: "Wake up", message: messageData });
    const time = makeNote("time", "time", { time: timeData });
    const timeIntoMessage = planComboInsertion(message, time);
    const messageIntoTime = planComboInsertion(time, message);

    expect(timeIntoMessage).toMatchObject({ type: "message", text: "Wake up", time: { view: "time" }, message: messageData });
    expect(messageIntoTime).toMatchObject({ type: "message", text: "Wake up", time: { view: "time" }, message: messageData });
    expect(timeIntoMessage).toEqual(messageIntoTime);
  });

  it("produces identical Note/Task fields when Message and Time are inserted in any order", () => {
    const host = makeNote("task", "note", { task: { done: false, doneAt: null }, text: "Review this" });
    const message = makeNote("message", "message", { text: "discarded message text", message: messageData });
    const time = makeNote("time", "time", { time: timeData });

    const messageThenTime = merged(merged(host, message), time);
    const timeThenMessage = merged(merged(host, time), message);
    const combinedThenHost = merged(host, merged(message, time));
    const fields = (note: Note) => ({ type: note.type, text: note.text, message: note.message, time: note.time, embedSections: note.embedSections });

    expect(fields(messageThenTime)).toEqual(fields(timeThenMessage));
    expect(fields(timeThenMessage)).toEqual(fields(combinedThenHost));
    expect(fields(messageThenTime)).toMatchObject({ type: "note", text: "Review this", message: messageData, time: { view: "time" } });
  });

  it("adopts Note and Task fields when an already-combined part is inserted last", () => {
    const task = makeNote("task", "note", {
      task: { done: false, doneAt: null }, importance: "important", text: "Task text",
    });
    const message = makeNote("message", "message", { text: "unused", message: messageData });
    const time = makeNote("time", "time", { time: timeData });
    const noteAndMessage = merged(task, message);
    const noteAndTime = merged(task, time);
    replaceBoard([noteAndMessage, time]);
    const mergeMessageIntoTime = comboInsertCommand(noteAndMessage.id, time.id);
    expect(mergeMessageIntoTime).not.toBeNull();
    execute(mergeMessageIntoTime!);
    expect(board.notes.time).toMatchObject({
      type: "note", text: "Task text", task: { done: false, doneAt: null }, importance: "important",
      message: messageData, time: { view: "time" },
    });
    expect(history.entries).toHaveLength(1);
    undo();
    expect(board.notes.task).toEqual(noteAndMessage);
    expect(board.notes.time).toEqual(time);
    redo();

    clearHistory();
    replaceBoard([noteAndTime, message]);
    const mergeTimeIntoMessage = comboInsertCommand(noteAndTime.id, message.id);
    expect(mergeTimeIntoMessage).not.toBeNull();
    execute(mergeTimeIntoMessage!);
    expect(board.notes.message).toMatchObject({
      type: "note", text: "Task text", task: { done: false, doneAt: null }, importance: "important",
      message: messageData, time: { view: "time" },
    });
  });

  it("rejects duplicate parts and allows each part once", () => {
    const time = makeNote("time", "time", { time: timeData });
    const message = makeNote("message", "message", { message: messageData });
    const combined = makeNote("combined", "message", { message: messageData, time: { ...timeData, view: "time" } });

    expect(canInsertCombo(time, message)).toBe(true);
    expect(canInsertCombo(message, time)).toBe(true);
    expect(canInsertCombo(makeNote("second-time", "time", { time: timeData }), combined)).toBe(false);
    expect(canInsertCombo(makeNote("second-message", "message", { message: messageData }), combined)).toBe(false);
  });

  it("shows sections expanded by default and persists collapse state", () => {
    const host = makeNote("host", "note", { message: messageData, time: { ...timeData, view: "time" } });
    expect(comboSectionsFor(host)).toEqual(["message", "time"]);
    expect(sectionExpanded(undefined, "message")).toBe(true);
    const collapsed = nextSectionState(undefined, "message");
    expect(collapsed).toEqual({ message: false });
    expect(sectionExpanded(collapsed, "message")).toBe(false);
    expect(copyEmbedSections(parseEmbedSections(collapsed)!)).toEqual(collapsed);
    expect(parseEmbedSections({ message: "closed" })).toBeNull();
  });

  it("stores embedded data through project, clipboard, archive, and trash serialization", () => {
    const host = makeNote("host", "note", {
      task: { done: false, doneAt: null }, message: messageData, time: timeData,
      embedSections: { message: false },
    });
    const project = parseProjectIndex(serializeProjectIndex([host]));
    const loaded = mergeLoadedNotes(project, [{
      id: host.id, name: host.name, file: project.notes[0]!.file, text: host.text,
      x: host.x, y: host.y, width: host.width, height: host.height,
    }]);
    expect(loaded[0]).toMatchObject({ message: messageData, time: { view: "time" }, embedSections: { message: false } });

    const clipboard = parseNotesPayload(serializeNotes([host]));
    expect(clipboard?.nodes[0]).toMatchObject({ message: messageData, time: { view: "time" }, embedSections: { message: false } });

    const archived = sanitizeArchiveEntries([{ id: "archive-entry", archivedAt: 1, note: host, links: [] }]);
    const trashed = sanitizeTrashEntries([{ id: "trash-entry", deletedAt: 1, notes: [host], zones: [], links: [] }]);
    expect(archived.entries[0]?.note).toMatchObject({ message: messageData, time: { view: "time" }, embedSections: { message: false } });
    expect(trashed.entries[0]?.notes[0]).toMatchObject({ message: messageData, time: { view: "time" }, embedSections: { message: false } });
  });

  it("undoes and redoes an insertion as one step while restoring the removed source and links", () => {
    const host = makeNote("host", "message", { text: "Host reminder", message: messageData });
    const time = makeNote("time", "time", { time: timeData });
    replaceBoard([host, time]);
    replaceLinks([edge("time-host", time.id, host.id)]);

    const command = comboInsertCommand(time.id, host.id);
    expect(command).not.toBeNull();
    execute(command!);
    expect(board.order).toEqual(["host"]);
    expect(board.notes.host).toMatchObject({ type: "message", time: { view: "time" }, message: messageData });
    expect(Object.keys(links.byId)).toHaveLength(0);
    expect(history.entries).toHaveLength(1);

    undo();
    expect(board.order).toEqual(["host", "time"]);
    expect(board.notes.host).toEqual(host);
    expect(board.notes.time).toEqual(time);
    expect(links.byId["time-host"]).toEqual(edge("time-host", "time", "host"));
    redo();
    expect(board.order).toEqual(["host"]);
    expect(board.notes.host.time?.view).toBe("time");
    expect(history.entries).toHaveLength(1);
  });

  it("pulls embedded Time out with the expected strong link and one Undo step", () => {
    const host = makeNote("task", "note", {
      task: { done: false, doneAt: null }, message: messageData, time: { ...timeData, view: "time" },
      embedSections: { message: false },
    });
    replaceBoard([host]);
    expect(extractComboPart(host.id, "time", { x: 100, y: 100 })).toBe(true);
    const newId = board.order.find((id) => id !== host.id)!;
    expect(board.notes[host.id]?.time).toBeUndefined();
    expect(board.notes[newId]).toMatchObject({ type: "time", time: { view: "time" } });
    expect(Object.values(links.byId)).toEqual([edge(expect.any(String), host.id, newId)]);
    expect(history.entries).toHaveLength(1);

    undo();
    expect(board.order).toEqual([host.id]);
    expect(board.notes[host.id]).toMatchObject({ message: messageData, time: { view: "time" }, embedSections: { message: false } });
    expect(Object.keys(links.byId)).toHaveLength(0);
  });

  it("pulls Message out of a Message+Time node with Time → Message direction", () => {
    const host = makeNote("combined", "message", { text: "Alert", message: messageData, time: { ...timeData, view: "time" } });
    replaceBoard([host]);
    expect(extractComboPart(host.id, "message", { x: 100, y: 100 })).toBe(true);
    const messageId = board.order.find((id) => id !== host.id)!;
    expect(board.notes[host.id]).toMatchObject({ type: "time", time: { view: "time" }, message: undefined });
    expect(board.notes[messageId]).toMatchObject({ type: "message", text: "Alert", message: messageData });
    expect(Object.values(links.byId)).toEqual([edge(expect.any(String), host.id, messageId)]);
    undo();
    expect(board.notes[host.id]).toMatchObject({ type: "message", text: "Alert", message: messageData, time: { view: "time" } });
  });
});

describe("embedded Time runtime routing", () => {
  it("accepts a strong Time → Message-section host and a Task+Message → Time host", () => {
    const embedded = makeNote("embedded", "note", { message: messageData });
    const task = makeNote("task", "note", { task: { done: false, doneAt: null }, message: messageData });
    const time = makeNote("time", "time");
    const notes = { embedded, task, time };
    expect(linkedMessagesForTime("time", notes, [edge("to-embedded", "time", "embedded")])).toEqual([embedded]);
    expect(taskMessageHostsForTime("time", notes, [edge("from-task", "task", "time")])).toEqual([task]);
  });

  it("forces embedded Time view while preserving its schedule and runtime data", () => {
    expect(copyTimeForHost("note", timeData)).toEqual({ ...timeData, view: "time" });
    expect(copyTimeForHost("time", timeData)).toEqual(timeData);
  });
});
