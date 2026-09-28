import { afterEach, describe, expect, it } from "vitest";
import type { Note } from "../src/model/note";
import { board, replaceBoard } from "../src/model/board.svelte";
import { clear, history, redo, undo } from "../src/history/history.svelte";
import { parseProjectIndex, mergeLoadedNotes, serializeProjectIndex } from "../src/project/index";
import { copyArchiveEntry, sanitizeArchiveEntries } from "../src/archive/serialization";
import { sanitizeTrashEntries } from "../src/trash/serialization";
import { copyTrashEntry } from "../src/trash/trash";
import { createNoteKind } from "../src/notes/noteCommands";
import { hasResizeHandle, RESIZE_EDGES, resizeRuleForKind } from "../src/selection/resize";
import { defaultMessageData } from "../src/messages/data";

function message(id = "message"): Note {
  return {
    id, type: "message", name: id, text: "Remember the experiment\nBring the results",
    x: 15, y: -10, width: 30, height: null, scale: 1.5,
    message: { sound: true, autoHideSeconds: 12.5 },
  };
}
afterEach(() => { replaceBoard([]); clear(); });

describe("Message integration", () => {
  it("creates silent persistent Message nodes at the fixed base width with auto height", () => {
    replaceBoard([]); clear();
    const id = createNoteKind("message");
    expect(board.notes[id]).toMatchObject({ type: "message", name: "Message", width: 30, height: null, message: defaultMessageData() });
    expect(history.entries).toHaveLength(1);
    expect(resizeRuleForKind("message")).toMatchObject({ width: "locked", height: "locked", handles: "none" });
    for (const edge of RESIZE_EDGES) expect(hasResizeHandle("message", edge)).toBe(false);
    undo(); expect(board.notes[id]).toBeUndefined();
    redo(); expect(board.notes[id].message).toEqual(defaultMessageData());
  });

  it("round trips multiline text, sound, expiration and Shift-scale through the project index", () => {
    const original = message();
    const index = parseProjectIndex(serializeProjectIndex([original]));
    const indexed = index.notes[0];
    const loaded = mergeLoadedNotes(index, [{ ...indexed, text: original.text }]);
    expect(loaded[0]).toMatchObject(original);
    expect(loaded[0].message).not.toBe(original.message);
  });

  it("keeps Message settings and text in both archive and trash snapshots across save/load", () => {
    const archived = { id: "archived", archivedAt: 42, note: message("archive-message"), links: [] };
    const trashed = { id: "trashed", deletedAt: 43, notes: [message("trash-message")], links: [], zones: [] };
    const index = parseProjectIndex(serializeProjectIndex([], undefined, [], [], [], [], {}, [archived], [trashed]));
    expect(index.archive[0].note).toMatchObject(archived.note);
    expect(index.trash[0].notes[0]).toMatchObject(trashed.notes[0]);
    const archiveCopy = copyArchiveEntry(index.archive[0]);
    const trashCopy = copyTrashEntry(index.trash[0]);
    archiveCopy.note.message!.sound = false;
    trashCopy.notes[0].message!.autoHideSeconds = null;
    expect(index.archive[0].note.message?.sound).toBe(true);
    expect(index.trash[0].notes[0].message?.autoHideSeconds).toBe(12.5);
    expect(sanitizeArchiveEntries([archived]).entries[0].note.message).toEqual(archived.note.message);
    expect(sanitizeTrashEntries([trashed]).entries[0].notes[0].message).toEqual(trashed.notes[0].message);
  });
});
