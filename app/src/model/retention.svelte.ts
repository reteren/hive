import type { Link } from "./link";
import type { Note } from "./note";
import type { Zone } from "./zone";

/**
 * R6 contracts: soft-deleted (trash) and archived board content. Both live in board.json
 * (`trash`, `archive`) so a restore brings back exactly what was removed. Raw mutations only —
 * user actions go through history commands in src/trash and src/archive.
 */

/** One Delete action: everything it removed (notes incl. text, zones, and the links of those notes). */
export interface TrashEntry {
  id: string;
  deletedAt: number;
  notes: Note[];
  zones: Zone[];
  links: Link[];
}

/** One archived note with the links it had when it was archived (H34: restore to old place or screen centre). */
export interface ArchiveEntry {
  id: string;
  archivedAt: number;
  note: Note;
  links: Link[];
}

export const trash = $state({ entries: [] as TrashEntry[] });
export const archive = $state({ entries: [] as ArchiveEntry[] });

export function replaceTrash(entries: TrashEntry[]): void {
  trash.entries = entries;
}

export function replaceArchive(entries: ArchiveEntry[]): void {
  archive.entries = entries;
}
