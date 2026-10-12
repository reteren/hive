import type { CalculatorData } from "../model/nodeData";
import type { Link } from "../model/link";
import type { Note } from "../model/note";
import type { ArchiveEntry, TrashEntry } from "../model/retention.svelte";
import type { TaskLogEntry } from "../tasks/taskLog.svelte";
import type { Zone } from "../model/zone";
import type { IndexedNote, ProjectIndex } from "./index";

export interface DeltaUpsert<T> {
  id: string;
  /** Current list position for ordered collections; omitted means retain or append. */
  order?: number;
  record: T;
}

export interface OrderedCollectionDelta<T> {
  upserts: DeltaUpsert<T>[];
  deleteIds: string[];
}

export interface KeyedCollectionDelta<T> {
  upserts: Array<{ id: string; record: T }>;
  deleteIds: string[];
}

export type ProjectDeltaHead = Partial<Pick<ProjectIndex, "createdAt" | "projectCounters" | "beaconMarks" | "meDeleted">>;

/** Incremental board save. Collection records are complete; omitted records remain untouched. */
export interface ProjectDelta {
  notes: OrderedCollectionDelta<IndexedNote>;
  links: OrderedCollectionDelta<Link>;
  zones: OrderedCollectionDelta<Zone>;
  trash: OrderedCollectionDelta<TrashEntry>;
  archive: OrderedCollectionDelta<ArchiveEntry>;
  taskLog: OrderedCollectionDelta<TaskLogEntry>;
  calculators: KeyedCollectionDelta<CalculatorData>;
  head: ProjectDeltaHead;
  changedFiles: Array<{ file: string; text: string }>;
}

export interface DeltaSaveRequest {
  baseRevision?: number;
  delta: ProjectDelta;
}

export interface JournalCapture<T> {
  readonly revision: number;
  readonly all: boolean;
  readonly ids: readonly string[];
  readonly versions: ReadonlyMap<string, number>;
  readonly entries: ReadonlyMap<string, JournalEntry<T>>;
}

export interface JournalEntry<T> {
  readonly version: number;
  readonly deleted: boolean;
  readonly record?: T;
  readonly order?: number;
}

/** Convert a captured journal to wire records without scanning the full collection. */
export function materializeCollectionDelta<T, R>(
  capture: JournalCapture<T>,
  current: (id: string) => R | undefined,
  orderOf?: (id: string) => number | undefined,
): OrderedCollectionDelta<R> {
  const upserts: DeltaUpsert<R>[] = [];
  const deleteIds: string[] = [];
  for (const id of capture.ids) {
    const entry = capture.entries.get(id);
    if (entry?.deleted) {
      deleteIds.push(id);
      continue;
    }
    const record = current(id);
    if (record === undefined) {
      deleteIds.push(id);
      continue;
    }
    const order = entry?.order ?? orderOf?.(id);
    upserts.push({ id, ...(order === undefined ? {} : { order }), record });
  }
  return { upserts, deleteIds };
}

export function materializeKeyedCollectionDelta<T>(
  capture: JournalCapture<T>,
  current: (id: string) => T | undefined,
): KeyedCollectionDelta<T> {
  const upserts: Array<{ id: string; record: T }> = [];
  const deleteIds: string[] = [];
  for (const id of capture.ids) {
    const entry = capture.entries.get(id);
    if (entry?.deleted) {
      deleteIds.push(id);
      continue;
    }
    const record = current(id);
    if (record === undefined) deleteIds.push(id);
    else upserts.push({ id, record });
  }
  return { upserts, deleteIds };
}

/** Per-ID mutation journal; capture/ack preserves edits made while an async save is in flight. */
export class DeltaMutationJournal<T> {
  private revision = 0;
  private all = false;
  private readonly entries = new Map<string, JournalEntry<T>>();

  markUpsert(id: string, record?: T, order?: number): void {
    this.revision += 1;
    this.entries.set(id, { version: this.revision, deleted: false, record, ...(order === undefined ? {} : { order }) });
  }

  markDelete(id: string): void {
    this.revision += 1;
    this.entries.set(id, { version: this.revision, deleted: true });
  }

  markAll(): void {
    this.revision += 1;
    this.all = true;
  }

  hasChanges(): boolean {
    return this.all || this.entries.size > 0;
  }

  pendingIds(): readonly string[] {
    return [...this.entries.keys()];
  }

  capture(currentIds: readonly string[] = [], savedIds: readonly string[] = []): JournalCapture<T> {
    const ids = new Set(this.entries.keys());
    if (this.all) {
      for (const id of currentIds) ids.add(id);
      for (const id of savedIds) ids.add(id);
    }
    return {
      revision: this.revision,
      all: this.all,
      ids: [...ids],
      versions: new Map([...ids].flatMap((id) => {
        const entry = this.entries.get(id);
        return entry ? [[id, entry.version] as const] : [];
      })),
      entries: new Map([...ids].flatMap((id) => {
        const entry = this.entries.get(id);
        return entry ? [[id, entry] as const] : [];
      })),
    };
  }

  discard(id: string, version: number): void {
    if (this.entries.get(id)?.version === version) this.entries.delete(id);
  }

  acknowledge(capture: JournalCapture<T>): void {
    for (const [id, version] of capture.versions) this.discard(id, version);
    if (capture.all && capture.revision === this.revision) this.all = false;
  }

  reset(): void {
    this.revision = 0;
    this.all = false;
    this.entries.clear();
  }
}

/** Task log entries have no persisted `id`; note ID + completion timestamp is their stable key. */
export function taskLogRecordId(entry: Pick<TaskLogEntry, "noteId" | "doneAt">): string {
  return JSON.stringify([entry.noteId, entry.doneAt]);
}
