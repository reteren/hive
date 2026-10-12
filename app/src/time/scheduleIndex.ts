import type { Note } from "../model/note";

/** Incremental set of enabled notes with Time data; update on board mutations, read during ticks. */
export class EnabledTimeIndex {
  private readonly ids = new Set<string>();

  replace(noteIds: readonly string[], notes: Readonly<Record<string, Note | undefined>>): void {
    this.ids.clear();
    for (const id of noteIds) this.update(id, notes[id]);
  }

  update(id: string, note: Note | undefined): void {
    if (note?.time?.enabled) this.ids.add(id);
    else this.ids.delete(id);
  }

  values(): IterableIterator<string> {
    return this.ids.values();
  }

  has(id: string): boolean {
    return this.ids.has(id);
  }

  get size(): number {
    return this.ids.size;
  }
}
