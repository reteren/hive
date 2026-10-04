import { record } from "../history/history.svelte";
import { board, updateNote } from "../model/board.svelte";
import { isErasablePhoto, photoEraseGeometry, type PhotoEraseGeometry } from "../drawing/photoErase";
import type { DrawTool } from "../drawing/types";
import { drawingTools, setActiveDrawTool } from "../drawing/tools.svelte";
import { brushWorldWidth } from "../drawing/brush";
import { encodeRgbaPng } from "../drawing/png";
import { tool } from "../tools/tool.svelte";
import { registerNoteMenuItem } from "../notes/noteMenu";
import { attachmentUrl, importImageFile, reportImportError } from "./service";
import type { ImageRef } from "./types";

/**
 * Image erase mode (debug 24): the picture is decoded ONCE into a working canvas that replaces the
 * <img> while the mode is on; every stroke erases that canvas live (Canvas 2D, GPU-composited).
 * Ctrl+Z / Ctrl+Shift+Z inside the mode step through strokes. The attachment file is written once,
 * when the mode ends, and the canvas stays until the new picture has decoded, so nothing blinks.
 */
export const imageErase = $state({
  noteId: null as string | null,
  /** Bumps when the working canvas appears or goes away (ImageNodeBody swaps it in). */
  revision: 0,
});

interface EraseSession {
  noteId: string;
  original: ImageRef;
  canvas: HTMLCanvasElement;
  context: CanvasRenderingContext2D;
  undo: HTMLCanvasElement[];
  redo: HTMLCanvasElement[];
  dirty: boolean;
  last: { x: number; y: number } | null;
  stroke: { radius: number; core: number } | null;
}

const MAX_UNDO_STEPS = 40;
let session: EraseSession | null = null;
let committing: Promise<void> = Promise.resolve();
let previousMode: { tool: typeof tool.active; drawTool: DrawTool } | null = null;

/** The working canvas shown instead of this note's picture, while it is being erased. */
export function eraseSessionCanvas(noteId: string): HTMLCanvasElement | null {
  void imageErase.revision;
  return session?.noteId === noteId ? session.canvas : null;
}

/** Enter a scoped image erase mode while exposing the shared brush controls. */
export function enterImageErase(noteId: string): boolean {
  const note = board.notes[noteId];
  if (!note || !isErasablePhoto(note) || !note.image) return false;
  if (imageErase.noteId === null) previousMode = { tool: tool.active, drawTool: drawingTools.active };
  imageErase.noteId = noteId;
  setActiveDrawTool("eraser");
  tool.active = "draw";
  const image = note.image;
  void committing.then(() => openSession(noteId, image)).catch((error: unknown) => {
    reportImportError(error instanceof Error ? error.message : String(error));
    finishImageErase();
  });
  return true;
}

async function openSession(noteId: string, image: ImageRef): Promise<void> {
  if (imageErase.noteId !== noteId) return;
  const url = attachmentUrl(image.file);
  if (!url) throw new Error(`Could not load image attachment: ${image.name ?? "Image"}`);
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Could not load image attachment (${response.status}).`);
  const bitmap = await createImageBitmap(await response.blob());
  try {
    if (imageErase.noteId !== noteId) return;
    const canvas = document.createElement("canvas");
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    canvas.dataset.imageEraseCanvas = "";
    const context = canvas.getContext("2d");
    if (!context) throw new Error("Could not prepare the picture for erasing.");
    context.drawImage(bitmap, 0, 0);
    session = { noteId, original: image, canvas, context, undo: [], redo: [], dirty: false, last: null, stroke: null };
    imageErase.revision += 1;
  } finally {
    bitmap.close();
  }
}

function copyCanvas(source: HTMLCanvasElement): HTMLCanvasElement {
  const copy = document.createElement("canvas");
  copy.width = source.width;
  copy.height = source.height;
  copy.getContext("2d")?.drawImage(source, 0, 0);
  return copy;
}

function restoreFrom(target: EraseSession, source: HTMLCanvasElement): void {
  target.context.save();
  target.context.globalCompositeOperation = "copy";
  target.context.drawImage(source, 0, 0);
  target.context.restore();
}

/** World point → picture pixel, respecting flips; may lie outside the picture (strokes are clipped). */
function toPicture(point: { x: number; y: number }, geometry: PhotoEraseGeometry): { x: number; y: number } {
  const u = (point.x - geometry.x) / geometry.width;
  const v = (point.y - geometry.y) / geometry.height;
  return {
    x: (geometry.flipX ? 1 - u : u) * geometry.naturalWidth,
    y: (geometry.flipY ? 1 - v : v) * geometry.naturalHeight,
  };
}

/** Start a stroke at a world point; returns false when the point is not on the erased picture. */
export function beginImageEraseStroke(noteId: string, world: { x: number; y: number }, zoom: number): boolean {
  const current = session;
  const note = board.notes[noteId];
  const geometry = note ? photoEraseGeometry(note) : null;
  if (!current || current.noteId !== noteId || !geometry) return false;
  const u = (world.x - geometry.x) / geometry.width;
  const v = (world.y - geometry.y) / geometry.height;
  if (u < 0 || u > 1 || v < 0 || v > 1) return false;
  current.undo.push(copyCanvas(current.canvas));
  if (current.undo.length > MAX_UNDO_STEPS) current.undo.shift();
  current.redo = [];
  // Brush size is in screen px like the drawing eraser; convert to picture px.
  const radius = Math.max(0.5, brushWorldWidth(drawingTools.brush.size, zoom) / 2 * geometry.naturalWidth / geometry.width);
  const hardness = Math.min(1, Math.max(0, drawingTools.brush.hardness));
  current.stroke = { radius, core: Math.max(0, Math.min(radius * hardness, radius - 1)) };
  current.last = null;
  extendImageEraseStroke(world);
  return true;
}

/** Erase along the stroke up to this world point, on screen immediately. */
export function extendImageEraseStroke(world: { x: number; y: number }): void {
  const current = session;
  const note = current ? board.notes[current.noteId] : undefined;
  const geometry = note ? photoEraseGeometry(note) : null;
  if (!current || !current.stroke || !geometry) return;
  const point = toPicture(world, geometry);
  const from = current.last ?? point;
  const { radius, core } = current.stroke;
  const context = current.context;
  context.save();
  context.globalCompositeOperation = "destination-out";
  const distance = Math.hypot(point.x - from.x, point.y - from.y);
  // Soft dabs close enough together that the edge reads as one smooth stroke.
  const spacing = Math.max(0.75, radius * 0.12);
  const steps = Math.max(1, Math.ceil(distance / spacing));
  for (let step = current.last ? 1 : 0; step <= steps; step += 1) {
    const x = from.x + (point.x - from.x) * (step / steps);
    const y = from.y + (point.y - from.y) * (step / steps);
    const gradient = context.createRadialGradient(x, y, core, x, y, radius);
    gradient.addColorStop(0, "rgba(0,0,0,1)");
    gradient.addColorStop(0.5, "rgba(0,0,0,0.5)");
    gradient.addColorStop(1, "rgba(0,0,0,0)");
    context.fillStyle = core >= radius - 1 ? "#000" : gradient;
    context.beginPath();
    context.arc(x, y, radius, 0, Math.PI * 2);
    context.fill();
  }
  context.restore();
  current.last = point;
  current.dirty = true;
}

export function endImageEraseStroke(): void {
  if (!session) return;
  session.stroke = null;
  session.last = null;
}

/** Ctrl+Z inside the mode: one stroke back. Returns false when there is nothing to undo. */
export function undoImageEraseStroke(): boolean {
  const current = session;
  const previous = current?.undo.pop();
  if (!current || !previous) return false;
  current.redo.push(copyCanvas(current.canvas));
  restoreFrom(current, previous);
  current.dirty = true;
  return true;
}

export function redoImageEraseStroke(): boolean {
  const current = session;
  const next = current?.redo.pop();
  if (!current || !next) return false;
  current.undo.push(copyCanvas(current.canvas));
  restoreFrom(current, next);
  current.dirty = true;
  return true;
}

/** Finish the scoped mode: write the erased picture once (one Undo step) and restore the tools. */
export function finishImageErase(): void {
  if (imageErase.noteId === null) return;
  imageErase.noteId = null;
  const ended = session;
  committing = committing.then(() => commitSession(ended)).catch((error: unknown) => {
    reportImportError(error instanceof Error ? error.message : String(error));
  }).finally(() => {
    if (session === ended) {
      session = null;
      imageErase.revision += 1;
    }
  });

  const restore = previousMode;
  previousMode = null;
  if (!restore) return;
  setActiveDrawTool(restore.drawTool);
  tool.active = restore.tool;
}

async function commitSession(ended: EraseSession | null): Promise<void> {
  if (!ended || !ended.dirty || ended.undo.length === 0) return;
  const note = board.notes[ended.noteId];
  if (!note || note.type !== "image" || note.image?.file !== ended.original.file) return;
  const pixels = ended.context.getImageData(0, 0, ended.canvas.width, ended.canvas.height);
  const blob = await encodeRgbaPng(pixels.data, pixels.width, pixels.height);
  const baseName = (ended.original.name ?? note.name ?? "Image").replace(/\.[^.]*$/, "") || "Image";
  const imported = await importImageFile(new File([blob], `${baseName}.png`, { type: "image/png" }));
  if (!imported.ok) throw new Error(imported.error);
  const after = imported.image;
  const before = ended.original;
  // Decode the new picture before swapping it in, so the node never shows an empty frame.
  const url = attachmentUrl(after.file);
  if (url) {
    const probe = new Image();
    probe.src = url;
    await probe.decode().catch(() => undefined);
  }
  const current = board.notes[ended.noteId];
  if (!current || current.type !== "image" || current.image?.file !== before.file) return;
  updateNote(ended.noteId, { image: after });
  record({
    label: "Erase image",
    target: note.name,
    do() {
      if (board.notes[ended.noteId]?.type === "image") updateNote(ended.noteId, { image: after });
    },
    undo() {
      if (board.notes[ended.noteId]?.type === "image") updateNote(ended.noteId, { image: before });
    },
  });
}

/** Whether image erase mode is collecting strokes for a note right now. */
export function imageEraseReady(noteId: string): boolean {
  return session?.noteId === noteId;
}

registerNoteMenuItem({
  id: "image.erase",
  label: () => "Erase",
  run: (noteId) => { enterImageErase(noteId); },
  visible: (noteId) => {
    const note = board.notes[noteId];
    return Boolean(note && isErasablePhoto(note));
  },
  order: 13,
});
