import { afterEach, describe, expect, it } from "vitest";
import { boardDropKindForPath } from "../src/attachments/service";
import { groupBoardDropPaths } from "../src/formats/boardFileDrop";
import { createMarkdownNotes, initialMarkdownNoteHeight, MAX_IMPORTED_NOTE_HEIGHT } from "../src/formats/textDrop";
import { createSourceNotesFromAttachments } from "../src/source/creation";
import { sourceHasPicker } from "../src/source/logic";
import { parseSource } from "../src/model/nodeData";
import { board, replaceBoard } from "../src/model/board.svelte";
import { clear as clearHistory, history, undo } from "../src/history/history.svelte";
import { parseProjectIndex, serializeProjectIndex } from "../src/project/index";
import { sanitizeArchiveEntries } from "../src/archive/serialization";
import { sanitizeTrashEntries } from "../src/trash/serialization";
import { parseNotesPayload, serializeNotes } from "../src/clipboard/payload";

afterEach(() => {
  replaceBoard([]);
  clearHistory();
});

describe("OS file drops on the empty board", () => {
  it.each([
    ["C:\\drop\\picture.PNG", "image"],
    ["C:\\drop\\paper.pdf", "pdf"],
    ["C:\\drop\\voice.mp3", "audio"],
    ["C:\\drop\\clip.webm", "video"],
    ["C:\\drop\\chapter.MD", "markdown"],
    ["C:\\drop\\data.json", "format"],
    ["C:\\drop\\script.py", "format"],
    ["C:\\drop\\plain.txt", "format"],
    ["C:\\drop\\theme.css", "format"],
    ["C:\\drop\\program.exe", "source"],
    ["C:\\drop\\archive.7z", "source"],
  ] as const)("routes %s to %s", (path, kind) => {
    expect(boardDropKindForPath(path)).toBe(kind);
  });

  it("keeps every path of a mixed drop in routing order", () => {
    expect(groupBoardDropPaths(["tool.exe", "story.md", "poster.png", "config.json", "another.md"]))
      .toEqual([
        { kind: "image", paths: ["poster.png"] },
        { kind: "markdown", paths: ["story.md", "another.md"] },
        { kind: "format", paths: ["config.json"] },
        { kind: "source", paths: ["tool.exe"] },
      ]);
  });

  it("creates Markdown as an ordinary note with fitted auto height, unique name and one Undo", () => {
    const first = createMarkdownNotes([{ path: "C:\\docs\\idea.md", text: "First paragraph\nSecond paragraph" }], { x: 100, y: 80 });
    const second = createMarkdownNotes([{ path: "D:\\ideas\\idea.MD", text: "Other text" }], { x: 120, y: 80 });
    expect(board.notes[first[0]!]).toMatchObject({ type: "note", name: "idea", text: "First paragraph\nSecond paragraph", height: null });
    expect(board.notes[second[0]!]?.name).toBe("idea 2");
    expect(history.entries).toHaveLength(2);
    undo();
    expect(board.notes[second[0]!]).toBeUndefined();
    expect(board.notes[first[0]!]).toBeDefined();
  });

  it("caps only long Markdown notes at 80 u while keeping all text", () => {
    const text = Array.from({ length: 300 }, (_, index) => `line ${index}`).join("\n");
    expect(initialMarkdownNoteHeight("short")).toBeNull();
    expect(initialMarkdownNoteHeight(text)).toBe(MAX_IMPORTED_NOTE_HEIGHT);
    const [id] = createMarkdownNotes([{ path: "C:\\docs\\long.md", text }], { x: 0, y: 0 });
    expect(board.notes[id!]).toMatchObject({ type: "note", height: MAX_IMPORTED_NOTE_HEIGHT, text });
  });

  it("links unsupported files as project-local Source attachments", () => {
    const [id] = createSourceNotesFromAttachments([{ file: "tool.exe", name: "tool.exe" }], { x: 0, y: 0 });
    const note = board.notes[id!]!;
    expect(note).toMatchObject({ type: "source", name: "tool.exe" });
    expect(note.media).toBeUndefined();
    expect(note.source).toEqual({ url: null, filePath: null, file: "tool.exe", description: "" });
    expect(sourceHasPicker(note.source)).toBe(true);
    expect(sourceHasPicker({ url: null, filePath: "C:\\elsewhere\\file.txt", description: "" })).toBe(true);
    expect(history.entries).toHaveLength(1);
    undo();
    expect(board.notes[id!]).toBeUndefined();
  });

  it("retains locked Source through every persistence boundary", () => {
    const [id] = createSourceNotesFromAttachments([{ file: "tool.exe", name: "tool.exe" }], { x: 0, y: 0 });
    const note = board.notes[id!]!;
    expect(parseSource(note.source)).toEqual(note.source);
    expect(parseProjectIndex(serializeProjectIndex([note])).notes[0]?.source).toEqual(note.source);
    expect(sanitizeArchiveEntries([{ id: "a", archivedAt: 1, note, links: [] }]).entries[0]?.note.source).toEqual(note.source);
    expect(sanitizeTrashEntries([{ id: "t", deletedAt: 1, notes: [note], zones: [], links: [] }]).entries[0]?.notes[0]?.source).toEqual(note.source);
    expect(parseNotesPayload(serializeNotes([note], []))?.nodes[0]?.source).toEqual(note.source);
  });
});
