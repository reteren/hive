# d43-c report: interaction and Rust persistence backend

## Changes

- `app/src-tauri/src/board_store.rs`: cache object bytes, parsed values, and `_order` metadata when loading the split board; unchanged records skip reserialization, and changed records verify their on-disk baseline before writing. `assign_orders` now uses a segment tree for first-successor queries instead of rescanning every suffix. The watcher can compare individual paths against the synced cache, and temporary/non-JSON files no longer trigger board reloads.
- `app/src-tauri/src/project.rs` and `app/src-tauri/src/watcher.rs`: note loading returns content fingerprints with the Markdown text, and the note watcher seeds those values rather than rereading the notes directory. Successful project saves and observed note changes invalidate the backup fingerprint cache.
- `app/src-tauri/src/board_watch.rs`: board events matching this process's synced bytes are skipped; drawing events hash only the changed `.png` paths. External board/drawing changes and app drawing writes invalidate the backup fingerprint cache.
- `app/src-tauri/src/backup.rs`: reuse a per-project fingerprint until a save, restore, or watcher-confirmed change marks that project dirty.
- `app/src/selection/SelectionLayer.svelte`, `hitTesting.ts`: Alt-click and marquee use visibility spatial queries, filter exact bounds, and sort only candidates by cached paint order. Selection outlines project only selected IDs in `visible.ids`.
- `app/src/selection/dropTargets.ts`, `app/src/list/ListBody.svelte`, `app/src/tierlist/TierlistBody.svelte`: skip target sweeps for multi-note previews and reject points outside target model bounds before reading DOM rectangles.
- `app/src/search/matching.ts`, `app/src/search/SearchPanel.svelte`, `app/src/search/nameIndex.ts`, `app/src/navigation/ObjectsPanel.svelte`: maintain normalized trigram postings incrementally for search text and object names; only changed search fields are reindexed.
- `app/tests/search.index.test.ts`: covers normalized matching, incremental updates/removal, and name postings.

The selected-card DOM lookup remains unchanged per coordinator guidance: `NotesLayer` now mounts only visible plus selected/edited notes, so its existing start-of-drag scan is bounded by that mounted set and does no per-card layout reads.

## Measurements

Synthetic 3,000-node split project, generated under `%LOCALAPPDATA%\Temp\claude\d43_c\` and removed after the run. Measurements cover `board_store::read_document` and save planning/application, not full UI project startup.

- Open/read: 248.8 ms
- Unchanged save plan: 80.4 ms, zero board object writes
- One-note changed save: 76.0 ms, one board object write

## Verification

- `npm run check`: passed, 0 errors and 0 warnings.
- `npm test -- tests/search.index.test.ts`: passed, 3 tests.
- `CARGO_TARGET_DIR=target-b cargo test`: passed, 104 tests.
- Full `npm test`: 1,445 passed and 4 failed across `zonesMembership.test.ts` (2), `meBeacon.test.ts` (1), and `mcp.moreMethods.test.ts` (1). These assertions are in the b-owned zone membership/lookup area; no c-owned test failed. Rerun after the concurrent zone changes settle.

## Remaining

Rerun full `npm test` after the current zone membership changes are resolved. No other c-owned implementation work remains.
