import type { HistoryCommand } from "../history/historyStack";
import type { Link } from "../model/link";
import type { CustomMark } from "../model/nodeData";
import type { Note } from "../model/note";

export const MARKAS_PALETTE = [
  "#e58b83",
  "#e5bd67",
  "#91bd81",
  "#70b7b4",
  "#78a8d2",
  "#aa8bd2",
  "#d58bae",
  "#d0d0d0",
] as const;

export type MarkAsPatch = Partial<Pick<Note, "customMarks" | "customMarkFrame">>;
export type MarkAsPatchWriter = (noteId: string, patch: MarkAsPatch) => void;
export type MarkAsNoteValue = Pick<Note, "id" | "type" | "customMarks" | "customMarkFrame">;
export type MarkAsNoteLookup = Readonly<Record<string, MarkAsNoteValue | undefined>>;
export type MarkAsEdge = Pick<Link, "from" | "to" | "kind">;

export type CustomMarkInputResult =
  | { ok: true; value: Pick<CustomMark, "text" | "color"> }
  | { ok: false; error: string };

export function validateCustomMark(text: string, color: string): CustomMarkInputResult {
  const normalizedText = text.trim();
  const normalizedColor = color.trim().toLowerCase();
  if (!normalizedText) return { ok: false, error: "Enter a tag name." };
  if (normalizedText.length > 30) return { ok: false, error: "Tag names can be up to 30 characters." };
  if (!/^#[0-9a-f]{6}$/i.test(normalizedColor)) return { ok: false, error: "Choose a valid hex colour." };
  return { ok: true, value: { text: normalizedText, color: normalizedColor } };
}

/** Keep existing tags first and append only new text/colour pairs. */
export function mergeCustomMarks(
  current: readonly CustomMark[],
  additions: readonly CustomMark[],
): CustomMark[] {
  const result: CustomMark[] = [];
  const seen = new Set<string>();
  for (const mark of [...current, ...additions]) {
    if (!isCustomMark(mark)) continue;
    const key = customMarkKey(mark);
    if (seen.has(key)) continue;
    seen.add(key);
    result.push({ ...mark });
  }
  return result;
}

export function sameCustomMarkValue(first: CustomMark, second: CustomMark): boolean {
  return first.text === second.text && first.color.toLowerCase() === second.color.toLowerCase();
}

export function createMarkAsPatchCommand(
  note: Pick<Note, "id" | "name" | "customMarks" | "customMarkFrame">,
  patch: MarkAsPatch,
  write: MarkAsPatchWriter,
  label: string,
): HistoryCommand | null {
  const previous: MarkAsPatch = {
    customMarks: copyCustomMarks(note.customMarks),
    customMarkFrame: note.customMarkFrame,
  };
  const next: MarkAsPatch = {
    customMarks: "customMarks" in patch ? copyCustomMarks(patch.customMarks) : copyCustomMarks(note.customMarks),
    customMarkFrame: "customMarkFrame" in patch ? patch.customMarkFrame : note.customMarkFrame,
  };
  if (sameOptionalMarks(previous.customMarks, next.customMarks) &&
    previous.customMarkFrame === next.customMarkFrame) return null;

  return {
    label,
    target: note.name,
    do: () => write(note.id, copyMarkAsPatch(next)),
    undo: () => write(note.id, copyMarkAsPatch(previous)),
  };
}

export function effectiveCustomMarksFor(
  noteId: string,
  notes: MarkAsNoteLookup,
  edges: readonly MarkAsEdge[],
): CustomMark[] {
  const note = notes[noteId];
  if (note?.type === "markas") return mergeCustomMarks([], note.customMarks ?? []);
  if (!isContentNote(note)) return [];

  let marks = mergeCustomMarks([], note.customMarks ?? []);
  for (const edge of edges) {
    if (edge.kind !== "strong" || edge.to !== noteId) continue;
    const source = notes[edge.from];
    if (source?.type !== "markas") continue;
    marks = mergeCustomMarks(marks, source.customMarks ?? []);
  }
  return marks;
}

export function linkedCustomMarksFor(
  noteId: string,
  notes: MarkAsNoteLookup,
  edges: readonly MarkAsEdge[],
): CustomMark[] {
  const marks: CustomMark[] = [];
  for (const edge of edges) {
    if (edge.kind !== "strong" || edge.to !== noteId) continue;
    const source = notes[edge.from];
    if (source?.type === "markas") marks.push(...(source.customMarks ?? []));
  }
  return mergeCustomMarks([], marks);
}

export function effectiveCustomMarkFrameFor(
  noteId: string,
  notes: MarkAsNoteLookup,
  edges: readonly MarkAsEdge[],
): boolean {
  const note = notes[noteId];
  if (note?.type === "markas") return note.customMarkFrame === true && (note.customMarks?.length ?? 0) > 0;
  if (!isContentNote(note)) return false;
  if (note.customMarkFrame === true && (note.customMarks?.length ?? 0) > 0) return true;
  return edges.some((edge) => {
    if (edge.kind !== "strong" || edge.to !== noteId) return false;
    const source = notes[edge.from];
    return source?.type === "markas" && source.customMarkFrame === true && (source.customMarks?.length ?? 0) > 0;
  });
}

export function customMarkFrameColorsFor(
  noteId: string,
  notes: MarkAsNoteLookup,
  edges: readonly MarkAsEdge[],
): string[] {
  if (!effectiveCustomMarkFrameFor(noteId, notes, edges)) return [];
  return effectiveCustomMarksFor(noteId, notes, edges).map((mark) => mark.color);
}

/** A two-period gradient lets the animated background scroll one full colour cycle seamlessly. */
export function customMarkGradientFor(colors: readonly string[]): string | undefined {
  if (colors.length === 0) return undefined;
  if (colors.length === 1) return `linear-gradient(90deg, ${colors[0]}, ${colors[0]})`;
  const cycle = [...colors, colors[0]];
  const stops = cycle.map((color, index) => `${color} ${(index * 50) / (cycle.length - 1)}%`);
  stops.push(...cycle.slice(1).map((color, index) => `${color} ${50 + ((index + 1) * 50) / (cycle.length - 1)}%`));
  return `linear-gradient(90deg, ${stops.join(", ")})`;
}

function isContentNote(note: MarkAsNoteValue | undefined): note is MarkAsNoteValue {
  return note?.type === "note" || note?.type === "pro" || note?.type === "con";
}

function isCustomMark(value: CustomMark): boolean {
  return typeof value.id === "string" && value.id.length > 0 &&
    typeof value.text === "string" && value.text.trim().length > 0 && value.text.length <= 30 &&
    typeof value.color === "string" && /^#[0-9a-f]{6}$/i.test(value.color);
}

function customMarkKey(mark: CustomMark): string {
  return `${mark.text}\u0000${mark.color.toLowerCase()}`;
}

function copyCustomMarks(marks: readonly CustomMark[] | undefined): CustomMark[] | undefined {
  return marks?.map((mark) => ({ ...mark }));
}

function copyMarkAsPatch(patch: MarkAsPatch): MarkAsPatch {
  return {
    customMarks: copyCustomMarks(patch.customMarks),
    customMarkFrame: patch.customMarkFrame,
  };
}

function sameOptionalMarks(first: CustomMark[] | undefined, second: CustomMark[] | undefined): boolean {
  if (first === undefined || second === undefined) return first === second;
  return first.length === second.length && first.every((mark, index) =>
    mark.id === second[index]?.id && sameCustomMarkValue(mark, second[index]!),
  );
}
