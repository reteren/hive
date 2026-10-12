# d43 report b — links, zones, beacons, overview

## Changes

- Added ordered endpoint adjacency for links and synchronous `linksRevision()` / `zonesRevision()` counters. Link mutation notifications identify topology changes so smooth-anchor synchronization can ignore anchor-only updates.
- Replaced whole-board zone membership checks with dirty note IDs, a zone-bounds grid index, cached resolved membership, and a reverse zone-members map. Geometry changes query notes intersecting the old/new zone bounds; measured-height changes use the coordinator's `notifyBoardMutation([noteId])` path. Existing largest-area, edge-contact, exact-tie, ME, and batch behavior is retained.
- Added a route-AABB index for links. Geometry is refreshed only for dirty links or links adjacent to changed notes, while the SVG renders route bounds intersecting `visible.rect`, plus selected, hovered, and cut-start links. Link drawing pointer moves return early without a matching gesture and use `cachedClientRect` for handled events.
- Replaced smooth-line geometry signatures with dirty-object synchronization using adjacency. Beacon and zone layers use visible IDs, hide labels below the full LOD tier except selected or focused objects, and the overview queries visible note/zone data rather than rebuilding from the full board on camera changes. Minimal link LOD paints plain thin routes.
- Added tests for adjacency ordering and revisions, route bounds queries, zone bounds updates/removals, and zone mutation/revision notifications.

## Verification and measurement

- `npm run check`: 0 errors, 0 warnings.
- `npm test`: 220 files passed; 1,459 tests passed.
- The existing `zoneMovePerformance` Vitest case measured 3.53 ms per update with 50 zones and 300 notes in the final run. This is an in-process synthetic test result, not a WebView drag profile and not directly comparable to the d42 3,000-node baseline.

## Files changed

- `app/src/model/links.svelte.ts`
- `app/src/model/zones.svelte.ts`
- `app/src/links/LinksLayer.svelte`
- `app/src/links/routeIndex.ts`
- `app/src/links/smoothLineSync.svelte.ts`
- `app/src/links/smoothLines.ts`
- `app/src/zones/ZonesLayer.svelte`
- `app/src/zones/membership.svelte.ts`
- `app/src/zones/zoneBoundsIndex.ts`
- `app/src/beacons/BeaconsLayer.svelte`
- `app/src/overview/OverviewNodes.svelte`
- `app/src/overview/OverviewZoneLabels.svelte`
- `app/tests/links.adjacency.test.ts`
- `app/tests/linkRouteIndex.test.ts`
- `app/tests/zoneBoundsIndex.test.ts`
- `docs/handoff/d43_report_b.md`

## Remaining measurement

No real-project or browser frame profile was run; the reported timing is limited to the synthetic zone-move test above.
