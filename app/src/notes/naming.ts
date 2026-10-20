import { noteFileKey, sanitizeNoteName } from "../project/fileNames";
import type { Note } from "../model/note";
import { t } from "../i18n/i18n.svelte";

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

  throw new Error(t("Could not find an unused note name."));
}

/**
 * Give every node a distinct name after two copies of a project were merged (two people each
 * created "Note 4"): the oldest keeps the name, the others become "Note 4 (1)", "Note 4 (2)"…
 * The choice depends only on createdAt and id, so both people rename the same nodes and their
 * next commits agree. Calculator mirrors share names on purpose and are left alone.
 * Renames in place; returns the renamed nodes.
 */
export function resolveDuplicateNames<T extends Pick<Note, "id" | "name" | "type" | "createdAt">>(
  notes: readonly T[],
): Array<{ note: T; from: string }> {
  const groups = new Map<string, T[]>();
  for (const note of notes) {
    if (note.type === "calculator") continue;
    const key = noteFileKey(note.name);
    const group = groups.get(key);
    if (group) group.push(note);
    else groups.set(key, [note]);
  }
  const occupied = new Set(notes.map((note) => noteFileKey(note.name)));
  const renamed: Array<{ note: T; from: string }> = [];
  for (const group of groups.values()) {
    if (group.length < 2) continue;
    group.sort((left, right) =>
      (left.createdAt ?? Number.MAX_SAFE_INTEGER) - (right.createdAt ?? Number.MAX_SAFE_INTEGER) ||
      (left.id < right.id ? -1 : left.id > right.id ? 1 : 0));
    let suffix = 1;
    for (const note of group.slice(1)) {
      // Room for " (n)" under the file name length limit, or the suffix would be cut off.
      const base = sanitizeNoteName(Array.from(note.name.trim()).slice(0, 100).join(""));
      let candidate = sanitizeNoteName(`${base} (${suffix})`);
      while (occupied.has(noteFileKey(candidate))) {
        suffix += 1;
        candidate = sanitizeNoteName(`${base} (${suffix})`);
      }
      suffix += 1;
      occupied.add(noteFileKey(candidate));
      renamed.push({ note, from: note.name });
      note.name = candidate;
    }
  }
  return renamed;
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
