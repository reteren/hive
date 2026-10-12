# d43 b3 — FarLayer tile cache and dynamic drag links

## Changes

- Replaced per-frame FarLayer list construction and object replay with a bounded cache of 512 px
  world-aligned bitmap tiles. Camera frames now clear the viewport, draw active tiles, and blit their
  cached bitmaps; tile draw lists are built only for cache misses, model changes, selection/focus
  changes, and zoom-bucket changes.
- Added reverse indexes from notes, links, and zones to cached tiles so a model change invalidates the
  tiles at its old and current locations. Cached tiles use a 15% logarithmic zoom bucket and the
  visible screen plus a one-tile prefetch margin. The tile cache is capped at 72 entries and image
  resolutions at 256 entries.
- Selected notes remain supplied by the DOM layer. On a selected-note mutation, FarLayer marks that
  note as moving, removes its incident links from affected static tiles, and paints those links as a
  small per-frame overlay using `linksOf`. After 120 ms without another mutation, it invalidates the
  affected tiles once to rebuild their final note-position and static-link content; still-selected
  notes remain excluded from the bitmap and are rendered by DOM.
- Image bitmaps are resolved on tile builds, with a limit of 32 image draws per tile build and two
  concurrent decodes. Link routes are batched by kind and opacity, reducing static link strokes to a
  handful of paint operations.

## Files

- `app/src/board/FarLayer.svelte`
- `app/src/board/farDrawList.ts`
- `app/src/board/farTileCache.ts`
- `app/tests/farDrawList.test.ts`
- `app/tests/farTileCache.test.ts`

## Measurements

The temporary node-canvas-free harnesses are under
`%LOCALAPPDATA%\Temp\claude\d43_b3\far-tiles.bench.ts` and
`%LOCALAPPDATA%\Temp\claude\d43_b3\far-drag.bench.ts`. They exercise the real draw-list and tile
cache code with no-op canvas methods, so the numbers cover JavaScript geometry/list work and cache
dispatch, not WebView2 rasterization or compositing.

| Harness fixture | Full-path baseline, median / p95 / max | Cached path, median / p95 / max | Other counts |
|---|---:|---:|---|
| Pan: 20,000 notes, 3,000 links, zoom 0.03; 120 frames (full-list rebuild + batched replay) | 3.072 / 5.251 / 8.860 ms | 0.003 / 0.009 / 1.007 ms | 35 tile blits per frame; 5 new tiles across the 120 pan frames; 40 cached at end |
| Drag: 3,000 notes, 2,500 links, zoom 0.1; 24 links incident to the moved note (full-list rebuild + per-link replay) | 0.520 / 1.811 / 2.923 ms | 0.007 / 0.019 / 0.051 ms | 35 static tile blits and 2 dynamic link strokes per frame |

For the pan fixture, the old unbatched count was 43,000 paint calls per full replay; grouped links
reduce the draw-list count to 40,002. Warm frames issue only the 35 tile blits. These are own-harness
measurements; the coordinator's integrated dev-build figures remain 73 ms/frame panning at 20k/3k
and 11–17 ms median with 55 ms p95 while dragging at 3k/2.5k. The app-level target still needs to be
confirmed in the integrated WebView2 build, where canvas raster/compositor costs are present.

## Verification

- `npm run check` — passed, 0 errors and 0 warnings.
- `npm test` — passed, 226 test files and 1,480 tests.
- `git diff --check` — passed; Git only reported its existing line-ending normalization warnings.
- Added tile-cache indexing/eviction/zoom tests and a link-batching stroke-count test.

## Remaining

Coordinator should measure the integrated app's panning and drag frame timings after wiring this
FarLayer into the active board build. The local harness does not measure browser canvas raster or
compositor time.
