# d43 e2 — delta saves

## Proposed request contract

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

Each collection upsert carries its stable key and full current record; ordered collections also carry the current list index so the backend can place a new or restored record without receiving unchanged records. Deletes use stable IDs (calculator keys for calculators; task-log entries use a deterministic key derived from `noteId` and `doneAt`). `head` is a partial patch of changed head/local fields (`createdAt`, `projectCounters`, `beaconMarks`, `meDeleted`); omitted fields remain unchanged. `changedFiles` carries only Markdown bodies that changed or need creation/recreation, while a note file rename with unchanged text is inferred from the note record and prior synced entry.

## Implementation

Pending.
