import type { Link } from "./link";
import type { Note } from "./note";
import type { Zone } from "./zone";
import type { CalculatorData } from "./nodeData";
import { markProjectChanged } from "../project/changeSignal.svelte";

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
  /** The virtual ME beacon was moved here; restoring it makes the project beacon visible again. */
  meBeacon?: true;
  /** Calculator contents of removed calculators (keyed by calculatorKey(name)); data is pruned from the board otherwise. */
  calculators?: Record<string, CalculatorData>;
}

/** One archived note with the links it had when it was archived (H34: restore to old place or screen centre). */
export interface ArchiveEntry {
  id: string;
  archivedAt: number;
  note: Note;
  links: Link[];
  /** Contents of an archived calculator (its board data is pruned once no calculator with that name remains). */
  calculatorData?: CalculatorData;
}

export const trash = $state({ entries: [] as TrashEntry[] });
export const archive = $state({ entries: [] as ArchiveEntry[] });

let trashChangeRevision = 0;
let archiveChangeRevision = 0;
const trashListeners = new Set<(revision: number) => void>();
const archiveListeners = new Set<(revision: number) => void>();

export function trashRevision(): number {
  return trashChangeRevision;
}

export function archiveRevision(): number {
  return archiveChangeRevision;
}

export function onTrashMutation(listener: (revision: number) => void): () => void {
  trashListeners.add(listener);
  return () => trashListeners.delete(listener);
}

export function onArchiveMutation(listener: (revision: number) => void): () => void {
  archiveListeners.add(listener);
  return () => archiveListeners.delete(listener);
}

export function updateTrashEntries(update: (entries: TrashEntry[]) => TrashEntry[] | void): void {
  const replacement = update(trash.entries);
  if (replacement) trash.entries = replacement;
  trashChangeRevision += 1;
  markProjectChanged();
  for (const listener of trashListeners) listener(trashChangeRevision);
}

export function updateArchiveEntries(update: (entries: ArchiveEntry[]) => ArchiveEntry[] | void): void {
  const replacement = update(archive.entries);
  if (replacement) archive.entries = replacement;
  archiveChangeRevision += 1;
  markProjectChanged();
  for (const listener of archiveListeners) listener(archiveChangeRevision);
}

export function replaceTrash(entries: TrashEntry[]): void {
  updateTrashEntries(() => entries);
}

export function replaceArchive(entries: ArchiveEntry[]): void {
  updateArchiveEntries(() => entries);
}
