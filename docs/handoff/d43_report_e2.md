# d43 e2 — delta saves

## Request contract

Keep the existing full-save request available as the fallback for migration, project creation, export, and recovery:

```json
{ "baseRevision": 17, "indexJson": "<complete index>", "changedFiles": [{ "file": "Note id.md", "text": "..." }] }
```

Ordinary saves use this delta form:

```json
{
  "baseRevision": 17,
  "delta": {
    "notes": { "upserts": [{ "id": "n1", "order": 8, "record": { "...": "complete IndexedNote" } }], "deleteIds": [] },
    "links": { "upserts": [], "deleteIds": [] },
    "zones": { "upserts": [], "deleteIds": [] },
    "trash": { "upserts": [], "deleteIds": [] },
    "archive": { "upserts": [], "deleteIds": [] },
    "taskLog": { "upserts": [], "deleteIds": [] },
    "calculators": { "upserts": [], "deleteIds": [] },
    "head": { "beaconMarks": [], "meDeleted": false },
    "changedFiles": [{ "file": "Note id.md", "text": "..." }]
  }
}
```

Each collection upsert carries its stable key and full current record; ordered collections can carry a current position when needed. Deletes use stable IDs (calculator keys for calculators; task-log entries use a deterministic key derived from `noteId` and `doneAt`). `head` is a partial patch of changed fields (`createdAt`, `projectCounters`, `beaconMarks`, `meDeleted`); omitted fields remain unchanged. `changedFiles` carries only Markdown bodies that changed or need recreation; a note file rename with unchanged text is inferred from the note record and prior synced entry.

## Implementation

- Added per-ID collection journals and `buildPendingProjectDelta()`. Ordinary autosaves and close flushes now send only dirty note records, changed records in links/zones/trash/archive/task log/calculators, changed head fields, and changed Markdown bodies. Full saves remain for migration/recovery and explicit legacy paths.
- Trash/archive updates, calculator edits, and task-log edits report affected IDs; full replacement operations mark the collection as replaced. GIF playback stop-state changes for board notes now call `updateNote`, so persistence and board mutation listeners see the write.
- Added Rust delta request parsing and apply logic. `board_store` plans only the named object file writes/deletes, checks cached bytes and board revision before overwriting, maintains note filename ownership for rename/collision checks, and patches its synced document in place after successful writes.

Files changed: `app/src/project/delta.ts`, `app/src/project/persistence.svelte.ts`, `app/src/model/retention.svelte.ts`, `app/src/calculator/calculators.svelte.ts`, `app/src/tasks/taskLog.svelte.ts`, `app/src/archive/actions.svelte.ts`, `app/src/trash/trashActions.svelte.ts`, `app/src/attachments/gifPlayback.svelte.ts`, `app/src-tauri/src/project.rs`, `app/src-tauri/src/board_store.rs`, `app/tests/project.delta.test.ts`, `app/tests/gifPlayback.test.ts`, and `docs/handoff/d43_report_e2.md`.

## Measurement and verification

A throwaway harness at `%LOCALAPPDATA%\Temp\claude\d43_e2\delta-benchmark.ts` compares a cached 10k-note full index serialization with serializing one changed note record and its delta request envelope. Median frontend time was 16.83 ms for the full request versus 0.006 ms for one delta record/request; payload size was 2,557,746 bytes versus 646 bytes. These are synthetic frontend timings, not an in-app drag trace.

A separate throwaway Rust harness seeded 10,000 Markdown notes and measured `board_store` delta planning and applying one changed object. Planning took 31.348 ms and writing/applying the synced cache took 2.822 ms, with one object-file write; this excludes Tauri request validation and Markdown staging and is not an end-to-end save benchmark.

`npm run check` passed with 0 errors and 0 warnings. Targeted frontend tests passed (11 tests across delta tracking, GIF playback, and dirty tracking); the latest full frontend run had 1 failure and 1,469 passes in `tests/noteKinds.test.ts`, an assertion affected by concurrent bulk-placement work. A standalone Rust harness ran all 13 `board_store` unit tests successfully; the full `cargo test` attempt is blocked by a moved `import_id` compile error in the concurrent `app/src-tauri/src/attachments.rs` work, which its owner is fixing.
