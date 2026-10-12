# d43 audit d — implementation report

## Implemented

| Priority | Work completed | Remaining |
|---|---|---|
| 1. Exact stroke keys | Stroke before-capture queries only the tiles intersecting the latest dirty stroke pieces. Commit groups pieces by destination tile rather than testing every source piece against every key in the stroke bounds. Oversized generic rectangle enumeration now throws a visible `RangeError` instead of silently returning no keys. | None for the stroke bounding-rectangle path. Generic oversized operations report an error rather than transparently chunking. |
| 2. Far zoom | The renderer queries only indexed tiles intersecting the viewport, prioritizes the working zoom level for load, and uses mipmapped fine-level tiles to keep fine-only marks sampled at coarse zoom. The spatial index caches its level ordering. | It still draws all visible levels, has no explicit coarse composite cache, and `drawQuads` still issues one GL draw per quad. |
| 3. Long-stroke transient memory | Live preview and early capture now request only stroke pieces intersecting the viewport/latest dirty region, avoiding a full stroke-piece traversal on each frame or pointer move. | Stroke state still retains two ping-pong buffers per touched tile until the stroke ends; no fixed transient GPU byte budget or CPU spill path was added. |
| 4. GPU residency | Project open stores the full tile-key index and loads textures on demand near the viewport. A 96-tile LRU cache evicts clean offscreen tiles; dirty tiles stay resident until their save succeeds. Save completion is revision-checked so an older readback cannot clear a newer dirty mark. | The 96-tile budget is soft while more than 96 tiles are dirty or needed by one operation. A viewport with more than 96 prioritized tiles loads only the first 96. |
| 5. Undo/save | `allKeys()` now returns cached stable ordering, snapshots yield in batches of 8, and PNG readbacks yield between tiles on a 2 ms slice budget. | Each snapshot/readback still copies or reads a full tile, and each individual GPU readback remains synchronous. |

## Measurement

A throwaway `vite-node` probe at `%LOCALAPPDATA%\Temp\claude\d43_d\index-bench.ts` compared 100 viewport queries over 30,000 indexed keys against scanning and parsing all keys each time. Indexed queries took 13.81 ms total; the full-key scan took 420.74 ms, with matching 291,000 total hits. This is a synthetic index microbenchmark, not an in-app stroke or frame measurement.

## Verification

- `npx vitest run tests/drawing.core.test.ts tests/drawing.selection.test.ts tests/drawing.eraseFill.test.ts`: 43 tests passed.
- Full `npm test`: 1,435 passed, 4 failed in unrelated concurrent changes (`mcp.readMethods.test.ts`, `tierlist.audioPlayback.test.ts`, `search.index.test.ts`, and `imageAlpha.test.ts`).
- `npm run check`: failed on errors in other concurrent work (missing zones membership module, project persistence, task actions, attachment UI, and tierlist tests); no drawing-file diagnostics were reported.
- No Rust files changed, so `cargo test` was not run.

## Files changed

- `app/src/drawing/DrawingLayer.svelte`
- `app/src/drawing/history.ts`
- `app/src/drawing/persistence.svelte.ts`
- `app/src/drawing/stroke.svelte.ts`
- `app/src/drawing/tileSpatialIndex.ts`
- `app/src/drawing/tileStore.svelte.ts`
- `app/src/drawing/types.ts`
- `app/tests/drawing.core.test.ts`
