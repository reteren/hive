# d43 report b2 — far-zoom canvas layer

## Changes

- Added `app/src/board/FarLayer.svelte` and `farDrawList.ts`. In the `min` LOD tier the canvas draws the world-space candidate lists for `visible.rect`: zones, routed links, filled note rectangles, decoded image thumbnails when available (grey boxes otherwise), and beacon dots. Canvas backing dimensions and transforms account for device pixel ratio; pan and zoom redraws reuse the draw list and only update the transform.
- Draw lists rebuild when the visible rectangle, board, links, zones, selection, focus, or active zone move changes. Notes come from `queryRect`, links from the shared route AABB index, and zones from the zone-bounds index. Done tasks and beacon focus use the existing dim levels; note frame/body colors include kind defaults and node overrides.
- Shared the link route index with the canvas and retained each indexed polyline for drawing. `LinksLayer`, `ZonesLayer`, and `BeaconsLayer` now suppress ordinary object DOM at `min`, retaining selected, focused, hovered, or actively edited items where applicable.
- Added a read-only `peekCachedDisplayBitmap` API. FarLayer draws a cached image immediately or requests small display-sized decodes, with no more than two active decodes at once, so missing image boxes can fill in progressively.
- Added draw-list tests and route-index point lifecycle assertions.

## Verification and measurement

- `npm run check`: 0 errors, 0 warnings.
- Focused Vitest run: 2 files passed, 5 tests passed (`farDrawList.test.ts`, `linkRouteIndex.test.ts`). The coordinator is running the full suite during integration.
- Node canvas-free benchmark at `%LOCALAPPDATA%\Temp\claude\d43_b2\far-drawlist.bench.ts`: 20,000 visible notes, 5,000 links, and 9 zones produced 45,018 paint operations. The last 30-sample run measured 2.46 ms median and 3.48 ms p95 for draw-list building; it excludes actual canvas paint time, which the coordinator will measure in the app.

## Files changed

- `app/src/board/FarLayer.svelte`
- `app/src/board/farDrawList.ts`
- `app/src/attachments/displayBitmap.ts`
- `app/src/links/routeIndex.ts`
- `app/src/links/LinksLayer.svelte`
- `app/src/zones/ZonesLayer.svelte`
- `app/src/beacons/BeaconsLayer.svelte`
- `app/tests/farDrawList.test.ts`
- `app/tests/linkRouteIndex.test.ts`
- `docs/handoff/d43_report_b2.md`

## Integration remaining

The coordinator needs to mount `FarLayer` in `Board.svelte` and finish the `NotesLayer` min-tier rule so only pinned notes remain in the DOM. The coordinator will measure actual canvas draw time and run the full test suite on the integrated build.
