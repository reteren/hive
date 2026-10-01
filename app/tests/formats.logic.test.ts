import { afterEach, describe, expect, it } from "vitest";
import type { MediaRef } from "../src/attachments/types";
import { clear as clearHistory, history, undo } from "../src/history/history.svelte";
import { board, replaceBoard } from "../src/model/board.svelte";
import { minimumHeightForKind, minimumWidthForKind } from "../src/selection/resize";
import { createFormatNotes } from "../src/formats/formatCreation";
import { clearAllFormatDrafts, formatDraft, setFormatDraft } from "../src/formats/formatDrafts";
import { formatLanguageForExtension, formatNodeKind, hasUnsavedFormatChanges, isFormatMediaKind, parseMediaRef, pdfFrameMetrics } from "../src/formats/formatLogic";
import { saveFormatText } from "../src/formats/formatActions";
import { parseNotesPayload, serializeNotes } from "../src/clipboard/payload";
import { sanitizeArchiveEntries } from "../src/archive/serialization";
import { sanitizeTrashEntries } from "../src/trash/serialization";
import { parseProjectIndex, serializeProjectIndex } from "../src/project/index";
import type { Note } from "../src/model/note";

const pdfRef: MediaRef = {
  file: `${"a".repeat(64)}.pdf`, mime: "application/pdf", size: 128, name: "brief.pdf", kind: "pdf",
};
const textRef: MediaRef = {
  file: `${"b".repeat(64)}.md`, mime: "text/plain", size: 32, name: "notes.md", kind: "text",
};

function mediaNote(type: "pdf" | "format", media: MediaRef, id: string): Note {
  return {
    id, type, name: media.name ?? "File", text: "", x: 12, y: 24,
    width: type === "pdf" ? 40 : 50, height: type === "pdf" ? 30 : null, createdAt: 10, media: { ...media },
  };
}

afterEach(() => {
  clearHistory();
  replaceBoard([]);
  clearAllFormatDrafts();
});

describe("PDF and Format nodes", () => {
  it("routes only PDF and supported text media into these node types", () => {
    expect(isFormatMediaKind("pdf")).toBe(true);
    expect(isFormatMediaKind("text")).toBe(true);
    expect(isFormatMediaKind("audio")).toBe(false);
    expect(formatNodeKind(pdfRef)).toBe("pdf");
    expect(formatNodeKind(textRef)).toBe("format");
    expect(formatNodeKind({ ...textRef, kind: "audio" })).toBeNull();
  });

  it("uses installed CodeMirror languages and keeps other extensions plain", () => {
    expect(formatLanguageForExtension("md")).toBe("markdown");
    expect(formatLanguageForExtension("ts")).toBe("javascript");
    expect(formatLanguageForExtension("css")).toBe("css");
    expect(formatLanguageForExtension("html")).toBe("html");
    expect(formatLanguageForExtension("py")).toBe("plain");
    expect(formatLanguageForExtension("json")).toBe("plain");
  });

  it("validates immutable media refs and enforces the PDF minimum resize size", () => {
    expect(parseMediaRef(pdfRef)).toEqual(pdfRef);
    expect(parseMediaRef({ ...pdfRef, file: "bad.pdf" })).toBeNull();
    expect(parseMediaRef({ ...pdfRef, mime: "text/plain" })).toBeNull();
    expect(minimumWidthForKind("pdf")).toBe(30);
    expect(minimumHeightForKind("pdf")).toBe(30);
  });

  it.each([
    [0.5, 1, 200, 130, 2],
    [1, 1, 400, 260, 1],
    [2, 1, 800, 520, 0.5],
    [0.5, 2, 400, 260, 1],
    [2, 1.5, 1200, 780, 1 / 3],
    [2, 4, 3200, 2080, 1 / 8],
  ])("keeps the PDF frame geometry while rasterizing at zoom %s and note scale %s", (zoom, noteScale, width, height, inverseScale) => {
    expect(pdfFrameMetrics(400, 260, zoom, noteScale)).toEqual({
      width, height, scale: zoom * noteScale, inverseScale,
    });
  });

  it("creates the PDF and Format nodes at the picker point in a single undo step", () => {
    const ids = createFormatNotes([pdfRef, textRef], { x: 100, y: 80 });
    expect(ids).toHaveLength(2);
    expect(board.notes[ids[0]!]).toMatchObject({ type: "pdf", x: 80, y: 65, width: 40, height: 30, media: pdfRef });
    expect(board.notes[ids[1]!]).toMatchObject({ type: "format", x: 77.2, y: 70.2, width: 50, height: null, media: textRef });
    expect(history.entries).toHaveLength(1);
    undo();
    expect(ids.every((id) => !board.notes[id])).toBe(true);
  });

  it("saves edited text by replacing one reference with one undoable model change", async () => {
    const note = mediaNote("format", textRef, "format-save-test");
    replaceBoard([note]);
    const saved: MediaRef = { ...textRef, file: `${"c".repeat(64)}.md`, size: 64 };
    const result = await saveFormatText(note.id, "updated contents", async (text, previous) => {
      expect(text).toBe("updated contents");
      expect(previous).toEqual(textRef);
      return { ok: true, media: saved };
    });
    expect(result).toEqual({ ok: true, previous: textRef, media: saved });
    expect(board.notes[note.id]?.media).toEqual(saved);
    expect(history.entries).toHaveLength(1);
    undo();
    expect(board.notes[note.id]?.media).toEqual(textRef);
  });

  it("marks only changed drafts unsaved and keeps them when the editor body unmounts", () => {
    expect(hasUnsavedFormatChanges("same", "same")).toBe(false);
    expect(hasUnsavedFormatChanges("draft", "saved")).toBe(true);
    setFormatDraft("draft-note", textRef, "project-path", "draft text");
    expect(formatDraft("draft-note", textRef, "project-path")).toBe("draft text");
  });

  it("round-trips media through project, archive, trash and clipboard serializers", () => {
    const pdf = mediaNote("pdf", pdfRef, "pdf-serialize");
    const format = mediaNote("format", textRef, "format-serialize");
    expect(parseProjectIndex(serializeProjectIndex([pdf, format])).notes.map((note) => note.media)).toEqual([pdfRef, textRef]);
    expect(sanitizeArchiveEntries([
      { id: "archive-pdf", archivedAt: 11, note: pdf, links: [] },
      { id: "archive-format", archivedAt: 12, note: format, links: [] },
    ]).entries.map((entry) => entry.note.media)).toEqual([pdfRef, textRef]);
    expect(sanitizeTrashEntries([
      { id: "trash-pdf", deletedAt: 11, notes: [pdf], zones: [], links: [] },
      { id: "trash-format", deletedAt: 12, notes: [format], zones: [], links: [] },
    ]).entries.map((entry) => entry.notes[0]?.media)).toEqual([pdfRef, textRef]);
    expect(parseNotesPayload(serializeNotes([pdf, format]))?.nodes.map((node) => node.media)).toEqual([pdfRef, textRef]);
  });

  it("does not expose an execution action for imported code files", () => {
    const source = import.meta.glob<string>("../src/formats/FormatNodeBody.svelte", { eager: true, query: "?raw", import: "default" });
    const component = Object.values(source)[0] ?? "";
    expect(component).not.toMatch(/plugin-shell|child_process|execSync|spawn\(/i);
    expect(component).not.toMatch(/>\s*Run(?:\s|<)/i);
  });
});
