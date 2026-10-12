export interface DirtyCapture {
  noteIds: readonly string[];
  noteVersions: ReadonlyMap<string, number>;
  noteRevision: number;
  indexRevision: number;
  allNotes: boolean;
}

/** Cheap mutation journal used to defer persistence work until the debounce expires. */
export class ProjectDirtyTracker {
  private readonly noteVersions = new Map<string, number>();
  private noteRevision = 0;
  private indexRevision = 0;
  private allNotes = false;
  private indexDirty = false;

  markNotes(ids: readonly string[] | null): void {
    this.noteRevision += 1;
    if (ids === null) {
      this.allNotes = true;
      return;
    }
    for (const id of ids) this.noteVersions.set(id, this.noteRevision);
  }

  markIndex(): void {
    this.indexDirty = true;
    this.indexRevision += 1;
  }

  hasChanges(extraNoteIds: ReadonlySet<string> = new Set()): boolean {
    return this.indexDirty || this.allNotes || this.noteVersions.size > 0 || extraNoteIds.size > 0;
  }

  hasIndexChanges(): boolean {
    return this.indexDirty;
  }

  pendingNoteIds(): readonly string[] {
    return [...this.noteVersions.keys()];
  }

  noteVersion(id: string): number | undefined {
    return this.noteVersions.get(id);
  }

  allNotesPending(): boolean {
    return this.allNotes;
  }

  currentNoteRevision(): number {
    return this.noteRevision;
  }

  discardNote(id: string, version: number): void {
    if (this.noteVersions.get(id) === version) this.noteVersions.delete(id);
  }

  discardAllNotes(revision: number): void {
    if (this.noteRevision === revision) {
      this.noteVersions.clear();
      this.allNotes = false;
    }
  }

  capture(allNoteIds: readonly string[], extraNoteIds: ReadonlySet<string> = new Set()): DirtyCapture {
    const ids = new Set([...this.noteVersions.keys(), ...extraNoteIds]);
    if (this.allNotes) for (const id of allNoteIds) ids.add(id);
    return {
      noteIds: [...ids],
      noteVersions: new Map(this.noteVersions),
      noteRevision: this.noteRevision,
      indexRevision: this.indexRevision,
      allNotes: this.allNotes,
    };
  }

  acknowledge(capture: DirtyCapture): void {
    for (const [id, version] of capture.noteVersions) {
      if (this.noteVersions.get(id) === version) this.noteVersions.delete(id);
    }
    if (this.noteRevision === capture.noteRevision) this.allNotes = false;
    if (this.indexRevision === capture.indexRevision) this.indexDirty = false;
  }

  reset(): void {
    this.noteVersions.clear();
    this.noteRevision = 0;
    this.indexRevision = 0;
    this.allNotes = false;
    this.indexDirty = false;
  }
}
