import { record } from "../history/history.svelte";
import { board, updateNote } from "../model/board.svelte";
import { isErasablePhoto, erasePhotoCopyOnWrite } from "../drawing/photoErase";
import type { DrawTool } from "../drawing/types";
import { drawingTools, setActiveDrawTool } from "../drawing/tools.svelte";
import { tool } from "../tools/tool.svelte";
import { registerNoteMenuItem } from "../notes/noteMenu";

export const imageErase = $state({ noteId: null as string | null });

let previousMode: { tool: typeof tool.active; drawTool: DrawTool } | null = null;

/** Enter a scoped image erase mode while exposing the shared brush controls. */
export function enterImageErase(noteId: string): boolean {
  const note = board.notes[noteId];
  if (!note || !isErasablePhoto(note)) return false;

  if (imageErase.noteId === null) {
    previousMode = { tool: tool.active, drawTool: drawingTools.active };
  }
  imageErase.noteId = noteId;
  setActiveDrawTool("eraser");
  tool.active = "draw";
  return true;
}

/** Finish the scoped mode and restore the drawing mode that was active before it started. */
export function finishImageErase(): void {
  if (imageErase.noteId === null) return;
  imageErase.noteId = null;

  const restore = previousMode;
  previousMode = null;
  if (!restore) return;
  setActiveDrawTool(restore.drawTool);
  tool.active = restore.tool;
}

/** Apply one completed brush mask to the selected image and record exactly one Undo entry. */
export async function eraseImageStroke(
  noteId: string,
  sourceMask: HTMLCanvasElement,
  rasterX: number,
  rasterY: number,
  opacity: number,
  pixelsPerUnit: number,
): Promise<boolean> {
  const note = board.notes[noteId];
  if (!note || !isErasablePhoto(note) || !note.image) return false;
  const before = note.image;
  const after = await erasePhotoCopyOnWrite(note, sourceMask, rasterX, rasterY, opacity, pixelsPerUnit);
  if (!after) return false;

  const current = board.notes[noteId];
  if (current !== note || current.type !== "image" || current.image?.file !== before.file) return false;

  updateNote(noteId, { image: after });
  record({
    label: "Erase image",
    target: note.name,
    do() {
      if (board.notes[noteId]?.type === "image") updateNote(noteId, { image: after });
    },
    undo() {
      if (board.notes[noteId]?.type === "image") updateNote(noteId, { image: before });
    },
  });
  return true;
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
