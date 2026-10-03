import { afterEach, describe, expect, it } from "vitest";
import type { MediaRef } from "../src/attachments/types";
import { clear as clearHistory, history, undo } from "../src/history/history.svelte";
import { board, replaceBoard } from "../src/model/board.svelte";
import { hasResizeHandle, minimumHeightForKind, minimumWidthForKind, resizeNote, resizeRuleForKind } from "../src/selection/resize";
import { createFormatNotes } from "../src/formats/formatCreation";
import { clearAllFormatDrafts, formatDraft, setFormatDraft } from "../src/formats/formatDrafts";
import {
  formatLanguageForExtension,
  formatNodeKind,
  hasUnsavedFormatChanges,
  isFormatMediaKind,
  normalizePdfZoom,
  parseMediaRef,
  pdfFrameMetrics,
  pdfViewerSource,
  pdfZoomLabel,
  PDF_RENDER_OVERSAMPLE,
  stepPdfZoom,
} from "../src/formats/formatLogic";
import { saveFormatText, setPdfZoom } from "../src/formats/formatActions";
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

  it("uses fixed two-times PDF raster dimensions independent of board zoom", () => {
    const metrics = [0.3, 1, 3].map(() => pdfFrameMetrics(400, 260));
    expect(metrics).toEqual([
      { width: 800, height: 520, scale: PDF_RENDER_OVERSAMPLE, inverseScale: 0.5 },
      { width: 800, height: 520, scale: PDF_RENDER_OVERSAMPLE, inverseScale: 0.5 },
      { width: 800, height: 520, scale: PDF_RENDER_OVERSAMPLE, inverseScale: 0.5 },
    ]);
    expect(metrics[0]).toEqual(metrics[1]);
    expect(metrics[1]).toEqual(metrics[2]);
  });

  it("recreates the PDF iframe when zoom or fit mode changes and keeps the level label in sync", () => {
    const source = "asset://localhost/file.pdf";
    const hundredUrl = pdfViewerSource(source, 100);
    const zoomedUrl = pdfViewerSource(source, 110);
    const fitUrl = pdfViewerSource(source, undefined);
    expect(hundredUrl).not.toBe(zoomedUrl);
    expect(zoomedUrl).not.toBe(fitUrl);
    expect(new URLSearchParams(pdfViewerSource(source, 165).split("#")[1]).get("zoom")).toBe("170");
    expect(pdfZoomLabel(undefined)).toBe("Fit");
    expect(pdfZoomLabel(100)).toBe("100%");
    expect(pdfZoomLabel(165)).toBe("170%");

    const component = Object.values(import.meta.glob<string>("../src/formats/PdfNodeBody.svelte", {
      eager: true,
      query: "?raw",
      import: "default",
    }))[0] ?? "";
    expect(component).toContain("{#key viewerSource}");
    expect(component).toContain("src={viewerSource}");
    expect(component).toContain("pdfZoomLabel(pdfZoom)");
  });

  it("lets PDF nodes resize vertically while preserving the 30-unit minimum", () => {
    expect(resizeRuleForKind("pdf")).toMatchObject({ width: "free", height: "free", handles: "all" });
    expect(hasResizeHandle("pdf", "bottom")).toBe(true);
    expect(minimumHeightForKind("pdf")).toBe(30);
    const resized = resizeNote(
      { id: "pdf-resize", type: "pdf", x: 4, y: 8, width: 40, height: 30, maxHeight: 12 },
      30,
      "bottom",
      { x: 0, y: 10 },
      false,
      1,
    );
    expect(resized).toMatchObject({ x: 4, y: 8, width: 40, height: 40 });
    const tooSmall = resizeNote(
      { id: "pdf-resize", type: "pdf", x: 4, y: 8, width: 40, height: 30 },
      30,
      "bottom",
      { x: 0, y: -40 },
      false,
      1,
    );
    expect(tooSmall.height).toBe(30);
  });

  it("hides the built-in PDF controls and keeps viewer zoom in URL parameters", () => {
    expect(normalizePdfZoom(44)).toBe(50);
    expect(normalizePdfZoom(55)).toBe(60);
    expect(normalizePdfZoom(304)).toBe(300);
    expect(normalizePdfZoom(Number.NaN)).toBeUndefined();
    expect(stepPdfZoom(undefined, 1)).toBe(110);
    expect(stepPdfZoom(undefined, -1)).toBe(90);
    expect(stepPdfZoom(300, 1)).toBe(300);
    expect(stepPdfZoom(50, -1)).toBe(50);
    const zoomParams = new URLSearchParams(pdfViewerSource("asset://localhost/file.pdf#page=3", 150).split("#")[1]);
    expect(zoomParams.get("toolbar")).toBe("0");
    expect(zoomParams.get("navpanes")).toBe("0");
    expect(zoomParams.get("zoom")).toBe("150");

    const fitParams = new URLSearchParams(pdfViewerSource("asset://localhost/file.pdf", undefined).split("#")[1]);
    expect(fitParams.get("toolbar")).toBe("0");
    expect(fitParams.get("navpanes")).toBe("0");
    expect(fitParams.get("zoom")).toBe("page-width");

    const sources = [0.3, 1, 3].map(() => pdfViewerSource("asset://localhost/file.pdf", 150));
    expect(sources).toEqual([
      "asset://localhost/file.pdf#toolbar=0&navpanes=0&zoom=150",
      "asset://localhost/file.pdf#toolbar=0&navpanes=0&zoom=150",
      "asset://localhost/file.pdf#toolbar=0&navpanes=0&zoom=150",
    ]);
  });

  it("places PDF controls in a separate strip and clips horizontal overflow in the document area", () => {
    const component = Object.values(import.meta.glob<string>("../src/formats/PdfNodeBody.svelte", {
      eager: true,
      query: "?raw",
      import: "default",
    }))[0] ?? "";
    const controlsIndex = component.indexOf('<div class="pdf-controls"');
    const documentIndex = component.indexOf('<div bind:this={documentViewport} class="pdf-document">');
    expect(controlsIndex).toBeGreaterThanOrEqual(0);
    expect(documentIndex).toBeGreaterThan(controlsIndex);
    expect(component).toContain("pdfZoomLabel(pdfZoom)");
    expect(component).toMatch(/\.pdf-controls\s*\{[\s\S]*?position:\s*relative;/);
    expect(component).toMatch(/\.pdf-document\s*\{[\s\S]*?overflow:\s*hidden;/);
    expect(component).toMatch(/\.pdf-viewer\s*\{[\s\S]*?overflow-x:\s*hidden;/);
    expect(component).not.toContain("camera.zoom");
    expect(component).toContain("pdfFrameMetrics(element.clientWidth, element.clientHeight)");
    expect(component).toContain("pdfViewerSource(source, pdfZoom)");
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

  it("changes PDF zoom as one undoable setting and restores fit-width mode", () => {
    const pdf = mediaNote("pdf", pdfRef, "pdf-zoom");
    replaceBoard([pdf]);

    setPdfZoom(pdf.id, 165);
    expect(board.notes[pdf.id]?.pdfZoom).toBe(170);
    expect(history.entries).toHaveLength(1);
    undo();
    expect(board.notes[pdf.id]?.pdfZoom).toBeUndefined();
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
    const pdf = { ...mediaNote("pdf", pdfRef, "pdf-serialize"), pdfZoom: 170 };
    const format = mediaNote("format", textRef, "format-serialize");
    expect(parseProjectIndex(serializeProjectIndex([pdf, format])).notes.map((note) => note.media)).toEqual([pdfRef, textRef]);
    expect(parseProjectIndex(serializeProjectIndex([pdf, format])).notes.map((note) => note.pdfZoom)).toEqual([170, undefined]);
    expect(sanitizeArchiveEntries([
      { id: "archive-pdf", archivedAt: 11, note: pdf, links: [] },
      { id: "archive-format", archivedAt: 12, note: format, links: [] },
    ]).entries.map((entry) => entry.note.media)).toEqual([pdfRef, textRef]);
    expect(sanitizeArchiveEntries([
      { id: "archive-pdf", archivedAt: 11, note: pdf, links: [] },
      { id: "archive-format", archivedAt: 12, note: format, links: [] },
    ]).entries.map((entry) => entry.note.pdfZoom)).toEqual([170, undefined]);
    expect(sanitizeTrashEntries([
      { id: "trash-pdf", deletedAt: 11, notes: [pdf], zones: [], links: [] },
      { id: "trash-format", deletedAt: 12, notes: [format], zones: [], links: [] },
    ]).entries.map((entry) => entry.notes[0]?.media)).toEqual([pdfRef, textRef]);
    expect(sanitizeTrashEntries([
      { id: "trash-pdf", deletedAt: 11, notes: [pdf], zones: [], links: [] },
      { id: "trash-format", deletedAt: 12, notes: [format], zones: [], links: [] },
    ]).entries.map((entry) => entry.notes[0]?.pdfZoom)).toEqual([170, undefined]);
    expect(parseNotesPayload(serializeNotes([pdf, format]))?.nodes.map((node) => node.media)).toEqual([pdfRef, textRef]);
    expect(parseNotesPayload(serializeNotes([pdf, format]))?.nodes.map((node) => node.pdfZoom)).toEqual([170, undefined]);
  });

  it("clamps a persisted PDF zoom before it reaches the model", () => {
    const indexed = JSON.parse(serializeProjectIndex([{ ...mediaNote("pdf", pdfRef, "pdf-clamp"), pdfZoom: 300 }])) as {
      notes: { pdfZoom?: number }[];
    };
    if (!indexed.notes[0]) throw new Error("Serialized PDF note is missing.");
    indexed.notes[0].pdfZoom = 305;
    expect(parseProjectIndex(JSON.stringify(indexed)).notes[0]?.pdfZoom).toBe(300);
  });

  it("does not expose an execution action for imported code files", () => {
    const source = import.meta.glob<string>("../src/formats/FormatNodeBody.svelte", { eager: true, query: "?raw", import: "default" });
    const component = Object.values(source)[0] ?? "";
    expect(component).not.toMatch(/plugin-shell|child_process|execSync|spawn\(/i);
    expect(component).not.toMatch(/>\s*Run(?:\s|<)/i);
  });
});
