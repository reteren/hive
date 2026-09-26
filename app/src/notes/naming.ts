import { noteFileKey, sanitizeNoteName } from "../project/fileNames";
import type { Note } from "../model/note";

export type CalculatorRenameTarget =
  | { ok: true; name: string }
  | { ok: false; message: string };

/**
 * Return a filesystem-safe, project-unique note name. Names become .md file names,
 * so uniqueness is checked with the same case-insensitive key the project uses on disk.
 */
export function uniqueName(base: string, existing: readonly string[]): string {
  const safeBase = sanitizeNoteName(base.trim());
  const occupied = new Set(existing.map(noteFileKey));

  if (!occupied.has(noteFileKey(safeBase))) return safeBase;

  for (let suffix = 2; suffix < Number.MAX_SAFE_INTEGER; suffix += 1) {
    const candidate = sanitizeNoteName(`${safeBase} ${suffix}`);
    if (!occupied.has(noteFileKey(candidate))) return candidate;
  }

  throw new Error("Could not find an unused note name.");
}

/** Calculator mirrors may share a display name, but no other node may use that filename key. */
export function calculatorRenameTarget(
  proposed: string,
  currentId: string,
  existing: readonly Pick<Note, "id" | "name" | "type">[],
): CalculatorRenameTarget {
  const name = sanitizeNoteName(proposed.trim());
  const key = noteFileKey(name);
  const conflict = existing.find((note) =>
    note.id !== currentId && note.type !== "calculator" && noteFileKey(note.name) === key,
  );
  if (conflict) {
    return { ok: false, message: `A non-calculator node already uses the name ${name}; rename cancelled.` };
  }
  return { ok: true, name };
}
