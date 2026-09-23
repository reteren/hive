import { noteFileKey, sanitizeNoteName } from "../project/fileNames";

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
