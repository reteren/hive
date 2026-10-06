import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { clear, history, redo, undo } from "../src/history/history.svelte";
import { board, replaceBoard } from "../src/model/board.svelte";
import { pointer } from "../src/board/camera.svelte";
import type { Note, NoteKind } from "../src/model/note";
import { selection } from "../src/selection/selection.svelte";
import { noteMenuItemsForContext } from "../src/notes/noteMenu";
import {
  addOrEditNoteGlow,
  closeNoteGlowPopover,
  noteGlowPopover,
  previewNoteGlowColor,
  previewNoteGlowOpacity,
  setGlowColorAsMain,
  noteGlowTargets,
} from "../src/notes/noteGlow.svelte";
import { defaultBeaconGlow, defaultNoteGlow, mainNoteColor, parseNoteGlow } from "../src/notes/noteGlowLogic";
import { parseNotesPayload, serializeNotes } from "../src/clipboard/payload";
import { duplicateSelection } from "../src/clipboard/commands";
import type { ArchiveEntry, TrashEntry } from "../src/model/retention.svelte";
import { parseProjectIndex, serializeProjectIndex } from "../src/project/index";

const glow = { color: "#ab34cd", opacity: 0.7, size: 2.4 } as const;

function note(id: string, type: NoteKind = "note", extra: Partial<Note> = {}): Note {
  return {
    id, type, name: id, text: "", x: 0, y: 0, width: 30, height: 20, ...extra,
  };
}

beforeEach(() => {
  clear();
  replaceBoard([]);
  selection.ids = [];
  selection.zoneIds = [];
  selection.primaryId = null;
  pointer.world = null;
  noteGlowPopover.current = null;
});

afterEach(() => {
  closeNoteGlowPopover(false);
  clear();
  replaceBoard([]);
  selection.ids = [];
  selection.zoneIds = [];
  selection.primaryId = null;
  pointer.world = null;
});

describe("node glow", () => {
  it("validates the complete glow and drops malformed optional data", () => {
    expect(parseNoteGlow({ color: "#AB34CD", opacity: 0.7, size: 2.4 })).toEqual(glow);
    expect(parseNoteGlow({ color: "#abc", opacity: 0.7, size: 2.4 })).toBeUndefined();
    expect(parseNoteGlow({ color: "#ab34cd", opacity: 0.04, size: 2.4 })).toBeUndefined();
    expect(parseNoteGlow({ color: "#ab34cd", opacity: 1.01, size: 2.4 })).toBeUndefined();
    expect(parseNoteGlow({ color: "#ab34cd", opacity: 0.7, size: 8.1 })).toBeUndefined();
    expect(parseNoteGlow(null)).toBeUndefined();
  });

  it("round trips glow through board, archive, trash, and clipboard persistence", () => {
    const live = note("live", "note", { glow });
    const archived: ArchiveEntry = { id: "archive-entry", archivedAt: 5, note: note("archived", "note", { glow }), links: [] };
    const trashed: TrashEntry = { id: "trash-entry", deletedAt: 6, notes: [note("trashed", "note", { glow })], zones: [], links: [] };
    const index = parseProjectIndex(serializeProjectIndex([live], undefined, [], [], [], [], {}, [archived], [trashed]));

    expect(index.notes[0]?.glow).toEqual(glow);
    expect(index.archive[0]?.note.glow).toEqual(glow);
    expect(index.trash[0]?.notes[0]?.glow).toEqual(glow);
    expect(parseNotesPayload(serializeNotes([live]))?.nodes[0]?.glow).toEqual(glow);
    const painted = note("painted", "note", { color: "#123456", accentColor: "#654321", glow });
    expect(parseNotesPayload(serializeNotes([painted]))?.nodes[0]).toMatchObject({
      color: "#123456", accentColor: "#654321", glow,
    });

    const malformed = JSON.parse(serializeProjectIndex([live], undefined, [], [], [], [], {}, [archived], [trashed])) as {
      notes: Array<Record<string, unknown>>;
      archive: Array<{ note: Record<string, unknown> }>;
      trash: Array<{ notes: Array<Record<string, unknown>> }>;
    };
    malformed.notes[0]!.glow = { color: "red", opacity: 0.7, size: 2.4 };
    malformed.archive[0]!.note.glow = { color: "red", opacity: 0.7, size: 2.4 };
    malformed.trash[0]!.notes[0]!.glow = { color: "red", opacity: 0.7, size: 2.4 };
    const badGlowIndex = parseProjectIndex(JSON.stringify(malformed));
    expect(badGlowIndex.notes[0]?.glow).toBeUndefined();
    expect(badGlowIndex.archive[0]?.note.glow).toBeUndefined();
    expect(badGlowIndex.trash[0]?.notes[0]?.glow).toBeUndefined();
    const badClipboard = JSON.parse(serializeNotes([live])) as { nodes: Array<Record<string, unknown>> };
    badClipboard.nodes[0]!.glow = { color: "red", opacity: 0.7, size: 2.4 };
    expect(parseNotesPayload(JSON.stringify(badClipboard))?.nodes[0]?.glow).toBeUndefined();
  });

  it("offers Add, Edit, and Remove glow for regular nodes but keeps beacon glow fixed", () => {
    const kinds: NoteKind[] = [
      "note", "pro", "con", "importance", "purpose", "mood", "beacon", "goal", "progress", "calculator",
      "tierlist", "stats", "archive", "trash", "inbox", "list", "source", "glossary", "map", "random", "markas",
      "time", "message", "calendar", "image", "pdf", "format", "audio", "video", "youtube",
    ];
    const notes = kinds.map((type) => note(type, type, type === "image"
      ? { image: { file: "image.gif", name: "image.gif", mime: "image/gif", size: 1, naturalWidth: 20, naturalHeight: 20 } }
      : {}));
    replaceBoard(notes);

    for (const item of notes) {
      const menu = noteMenuItemsForContext(item.id, item.type === "image" ? { kind: "board", noteId: item.id } : null);
      const action = menu.find((entry) => entry.id === "notes.glow.edit");
      if (item.type === "beacon") {
        expect(action).toBeUndefined();
        expect(menu.find((entry) => entry.id === "notes.glow.remove")).toBeUndefined();
      } else {
        expect(action, item.type).toBeDefined();
        expect(action?.label(item.id), item.type).toBe("Add glow");
      }
    }

    for (const item of notes) item.glow = { ...glow };
    for (const item of notes) {
      const menu = noteMenuItemsForContext(item.id, item.type === "image" ? { kind: "board", noteId: item.id } : null);
      if (item.type === "beacon") {
        expect(menu.find((entry) => entry.id === "notes.glow.edit")).toBeUndefined();
        expect(menu.find((entry) => entry.id === "notes.glow.remove")).toBeUndefined();
      } else {
        expect(menu.find((entry) => entry.id === "notes.glow.edit")?.label(item.id), item.type).toBe("Edit glow");
        expect(menu.find((entry) => entry.id === "notes.glow.remove")?.label(item.id), item.type).toBe("Remove glow");
      }
    }
    selection.ids = ["beacon", "note"];
    expect(noteGlowTargets("beacon")).toEqual(["note"]);
  });

  it("previews a multi-node popover and records its edits as one Undo step", () => {
    replaceBoard([note("first", "note", { color: "#123456" }), note("second", "pro")]);
    selection.ids = ["first", "second"];
    addOrEditNoteGlow("first", { x: 0, y: 0 }, 1);
    previewNoteGlowColor("#ff2200");
    previewNoteGlowOpacity(0.8);
    expect(board.notes.first?.glow).toMatchObject({ color: "#ff2200", opacity: 0.8 });
    expect(board.notes.second?.glow).toMatchObject({ color: "#ff2200", opacity: 0.8 });
    closeNoteGlowPopover(true);

    expect(history.entries).toHaveLength(1);
    expect(board.notes.first?.glow).toMatchObject({ color: "#ff2200", opacity: 0.8 });
    expect(board.notes.second?.glow).toMatchObject({ color: "#ff2200", opacity: 0.8 });
    undo();
    expect(board.notes.first?.glow).toBeUndefined();
    expect(board.notes.second?.glow).toBeUndefined();
    redo();
    expect(board.notes.first?.glow).toMatchObject({ color: "#ff2200", opacity: 0.8 });
  });

  it("duplicates glow and both node color fields", () => {
    replaceBoard([note("source", "note", { color: "#123456", accentColor: "#654321", glow })]);
    selection.ids = ["source"];
    pointer.world = { x: 100, y: 100 };

    duplicateSelection();

    const copy = Object.values(board.notes).find((item) => item.id !== "source");
    expect(copy).toMatchObject({ color: "#123456", accentColor: "#654321", glow });
    pointer.world = null;
  });

  it("restores the previous glow when the popover is cancelled", () => {
    replaceBoard([note("existing", "note", { glow })]);
    addOrEditNoteGlow("existing", { x: 1, y: 2 }, 1);
    previewNoteGlowColor("#abcdef");
    closeNoteGlowPopover(false);
    expect(board.notes.existing?.glow).toEqual(glow);
    expect(history.entries).toHaveLength(0);
  });

  it("uses each selected node's main or default frame color", () => {
    expect(mainNoteColor(note("painted", "note", { color: "#123abc" }))).toBe("#123abc");
    expect(mainNoteColor(note("plain"))).toBe("#353535");
    expect(mainNoteColor(note("plus", "pro"))).toBe("#293d2e");
    expect(mainNoteColor(note("minus", "con"))).toBe("#422d2c");
    expect(mainNoteColor(note("goal", "goal"))).toBe("#3b3422");
    expect(mainNoteColor(note("beacon", "beacon", { color: "#aabbcc" }))).toBe("#aabbcc");
    expect(defaultBeaconGlow(note("beacon", "beacon", { color: "#aabbcc", glow }))).toEqual({
      color: "#aabbcc", opacity: 1, size: 6.2,
    });
    expect(defaultBeaconGlow(note("old-beacon", "beacon"))).toMatchObject({ opacity: 1, size: 6.2 });
    expect(defaultNoteGlow(note("plain")).color).toBe("#353535");

    replaceBoard([note("painted", "note", { color: "#123abc" }), note("plain", "pro")]);
    selection.ids = ["painted", "plain"];
    addOrEditNoteGlow("painted", { x: 0, y: 0 }, 1);
    setGlowColorAsMain();
    closeNoteGlowPopover(true);
    expect(board.notes.painted?.glow?.color).toBe("#123abc");
    expect(board.notes.plain?.glow?.color).toBe("#293d2e");
  });
});
