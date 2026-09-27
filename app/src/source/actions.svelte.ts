import { record } from "../history/history.svelte";
import { board, updateNote } from "../model/board.svelte";
import type { SourceData } from "../model/nodeData";
import {
  createSourceEditCommand,
  normalizeSource,
  parseSourceValue,
  type SourceEditMeta,
  type SourceField,
  type SourceResourceValue,
} from "./logic";

export function setSourceField(
  noteId: string,
  field: SourceField,
  value: string | null,
  meta: SourceEditMeta,
): void {
  const note = board.notes[noteId];
  if (!note || note.type !== "source") return;

  commitSourceEdit(noteId, { [field]: value }, meta);
}

export function setSourceResourceValue(noteId: string, rawValue: string, meta: SourceEditMeta): void {
  const parsed = parseSourceValue(rawValue);
  const value: SourceResourceValue = parsed.kind === "url"
    ? { url: parsed.value, filePath: null }
    : parsed.kind === "path"
      ? { url: null, filePath: parsed.value }
      : { url: null, filePath: null };
  commitSourceEdit(noteId, value, meta);
}

function commitSourceEdit(
  noteId: string,
  patch: Partial<SourceData>,
  meta: SourceEditMeta,
): void {
  const note = board.notes[noteId];
  if (!note || note.type !== "source") return;

  const before = note.source ? { ...note.source } : undefined;
  const after = { ...normalizeSource(before), ...patch } as SourceData;
  if (sameSource(before, after)) return;

  const apply = (source: SourceData | undefined): void => {
    const current = board.notes[noteId];
    if (!current || current.type !== "source") return;
    if (source) updateNote(noteId, { source: { ...source } });
    else delete current.source;
  };

  apply(after);
  record(createSourceEditCommand({
    target: note.name,
    before,
    after,
    meta,
    apply,
  }));
}

function sameSource(left: SourceData | undefined, right: SourceData | undefined): boolean {
  const a = normalizeSource(left);
  const b = normalizeSource(right);
  return a.url === b.url && a.filePath === b.filePath && a.description === b.description;
}
