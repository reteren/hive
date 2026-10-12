# d43 e — frontend persistence, change marks, Info, MCP

## Implemented

- Replaced the reactive full-board snapshot check with a cheap mutation journal. Board mutations record note IDs; collection mutations record project-level revisions; the observer reads only those revisions and small metadata signals, then schedules the existing 500 ms debounce.
- Snapshots now build only after the debounce or during close flush. Note index entries are cached by ID and revision, and snapshot comparison/file lists are restricted to captured dirty IDs. Full serialization remains available for saves, project replacement/reconciliation, and close flush.
- Added cheap revision notifications and persistence helpers for trash, archive, task log, and calculators; routed their in-scope mutation callers through those helpers. Text edits continue to use `updateNote`.
- Changed own-save change marking to accept affected IDs and preserve unrelated fingerprints. Info now reads the saved file map directly, gets links through `linksOf`, and groups the task log by note ID. MCP linked-node reads use adjacency, ID reads avoid building the full board/file map, and board overview groups zone members in one pass.

## Files changed

- `app/src/project/persistence.svelte.ts`
- `app/src/project/index.ts`
- `app/src/project/dirtyTracking.ts`
- `app/src/changes/changeLogic.ts`
- `app/src/changes/changeMarks.svelte.ts`
- `app/src/info/NodeInfoWindow.svelte`
- `app/src/info/nodeInfoLogic.ts`
- `app/src/mcp/readMethods.ts`
- `app/src/mcp/viewMethods.ts`
- `app/src/model/retention.svelte.ts`
- `app/src/tasks/taskLog.svelte.ts`
- `app/src/tasks/taskActions.svelte.ts`
- `app/src/archive/actions.svelte.ts`
- `app/src/trash/trashActions.svelte.ts`
- `app/src/calculator/calculators.svelte.ts`
- `app/src/calculator/bankActions.svelte.ts`
- `app/tests/projectDirtyTracking.test.ts`
- `app/tests/projectIndex.test.ts`
- `app/tests/changeMarks.test.ts`
- `app/tests/nodeInfo.test.ts`
- `app/tests/mcp.readMethods.test.ts`

## Measurements

The temporary Vitest harness is at `%LOCALAPPDATA%\Temp\claude\d43_e\`. It creates synthetic ordinary notes with short bodies and no links or zones, warms up three times, then records 20 samples at 1,000 notes and 10 at 10,000 notes. Event time includes `updateNote`, the mutation callback, and `hasPendingDataChanges`; deferred snapshot time includes `makeSnapshot` and `isDirty`.

| Notes | Index bytes | Mutation + dirty check median | Deferred snapshot + dirty check median |
|---:|---:|---:|---:|
| 1,000 | 238,168 | 0.034 ms | 4.984 ms |
| 10,000 | 2,419,978 | 0.047 ms | 52.255 ms |

The d42 audit measured the previous synchronous `makeSnapshot` + `isDirty` path at 1,000 notes as 5.935 ms for a geometry change / 8.552 ms for the unchanged-index path, and at 10,000 notes as 64.807 ms / 93.989 ms. These are not identical benchmark operations: the new mutation + dirty-check measurement is the event path, while the full snapshot is now deferred; the comparable full-snapshot measurement remains O(N) but runs only after debounce or during a complete flush. Both harnesses use synthetic ordinary notes and omit rich data, links, zones, IPC, and disk I/O.

## Validation and remaining issues

- `npm run check`: passed, 0 errors and 0 warnings.
- The d43 e-specific project dirty tracking, index cache, change marks, Info, and MCP tests passed; the benchmark harness passed. The MCP read-method suite now has an explicit regression test for an ID lookup immediately after a note rename.
- `npm test`: passed, 1,456 tests in 219 files. The final full-suite run was after the shared zone and drawing changes were corrected.
- A read-through found that `app/src/attachments/gifPlayback.svelte.ts` mutates persisted `note.gifStopped` directly, bypassing `updateNote` and therefore the dirty-ID listener. That file belongs to task f; coordinator direction was requested before touching it, and the question is still pending.
