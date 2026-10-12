# d42 audit b — links, zones, beacons

Snapshot: repository `HEAD 66ac381` (2026-10-12). Scope: `app/src/links/*`, `app/src/links-in-text/*`, `app/src/zones/*`, `app/src/beacons/*`, and their model files. Read-only audit; no benchmark was run, so time costs below are **static estimates**, not measured timings.

## Hot paths

Assume a large case of N=10,000 notes and E=10,000 links. S is the number of notes with smooth lines enabled; Z is the number of zones; B is the number of beacons.

| # | What happens / where | Complexity per event | Why it hurts; estimated cost at 10,000 |
|---|---|---|---|
| 1 | Smooth-anchor synchronization: [`smoothLineSync.svelte.ts`](../../app/src/links/smoothLineSync.svelte.ts:17), [`smoothLines.ts`](../../app/src/links/smoothLines.ts:146), [`links.svelte.ts`](../../app/src/model/links.svelte.ts:59) | Relevant endpoint move: O(N+E+S·E) work, reflow coalesced to at most once per frame | `geometrySignature` scans every note and link. Reflow scans them again, then calls `linksOf` once per smooth note; `linksOf` itself filters all E links. At N=E=10k and S=100, that inner step alone visits about 1,000,000 links per reflow frame. Estimated by loop counts; not timed. |
| 2 | Auto-zone membership: [`membership.svelte.ts`](../../app/src/zones/membership.svelte.ts:82) | Any note bounds/height change: O(N) scan, plus O(Z × zone-shape work) for changed note(s) | The effect checks bounds and builds a key for every note on each geometry invalidation, even though its cache limits full zone tests to changed notes. At N=10k this is about 10k note checks per update/frame; an actual membership change can trigger a second pass. Estimated by loop counts. |
| 3 | Link render derivation and retained SVG: [`LinksLayer.svelte`](../../app/src/links/LinksLayer.svelte:108), [`LinksLayer.svelte`](../../app/src/links/LinksLayer.svelte:687) | Moving any linked note: O(E) scan / reconciliation; geometry rebuild O(degree) due cache | Every derivation visits every link, reads both endpoint bounds and colors, and returns all links. At E=10k that is about 10k loop iterations, up to 20k bound lookups and 20k color lookups per linked-note update, even when only incident links need new geometry. All links stay in the SVG: typically 2–3 `<path>` elements per link (hit path, shaft, arrow), plus up to one per-link gradient when endpoint colors differ; weak wave/zigzag dashes can add paths. No SVG marker definitions or link filters found. Estimated by loop/markup counts. |
| 4 | Global pointer handler layout read: [`LinksLayer.svelte`](../../app/src/links/LinksLayer.svelte:235), [`LinksLayer.svelte`](../../app/src/links/LinksLayer.svelte:375) | O(1) JS + possible synchronous layout on every pointermove | `onPointerMove` calls `localPoint` before checking for a link gesture, and `localPoint` calls `getBoundingClientRect`; an active link gesture may read it again through `worldPoint`. This handler therefore performs a layout read during ordinary node drags too. A prior hive knowledge measurement found ~120 ms across 120 brush pointermoves before rect caching (different handler/build; not a measurement of this path): [knowledge card](../../../Memory_Vault/PROJECTS/hive/MEMORY/KNOWLEDGE/getboundingclientrect-in-pointermove-forces-a-layout-per-event.md). |
| 5 | Link-drawing hover target scan: [`LinksLayer.svelte`](../../app/src/links/LinksLayer.svelte:181) | O(N) per pointermove while a link preview is active | Each preview update scans notes from topmost to bottommost and calls `noteBounds` until a hit. Worst case at N=10k is 10k bounds checks per preview move; it is not active during an ordinary note drag. Estimated by loop count. |

Other layer observations:

- `ZonesLayer` retains every zone path and label in its SVG. `pathFor` caches path strings, so panning/zooming does not rebuild them, but the browser still has O(Z) SVG groups and all contour vertices to consider. At 10k one-part zones that is roughly 10k paths, nested SVG labels, and text nodes.
- `BeaconsLayer` walks `board.order` and retains a DOM object, circle, and label for every beacon, including off-screen ones. The circles use two box shadows. Each rendered beacon calls `zoneOf`, which performs zone geometry checks again instead of consuming the membership sync's resolved entry; focus dimming itself is a cached `Set.has` lookup and does not traverse the graph on a pure coordinate move.
- Beacon coverage snapshots all notes and links when queried (`coverage.ts:51-79`) and focus derives descendants on focus/topology changes. This is a cold O(N+E) path (repeated per focused beacon for snapshot validation), not a per-pointermove path for coordinate-only drags.
- `links-in-text/format.ts` is stateless URL/address parsing and formatting; `contextMenu.svelte.ts` stores menu/status state. No board-wide or per-frame cost found there.
- During pan, the link and zone layers update one world transform; cached route/path strings avoid recomputing geometry. Zoom also changes link stroke-width expressions for every rendered link. Neither layer has app-level viewport culling or far-zoom LOD. Browser clipping may reduce raster work outside the viewport, but all link/zone DOM and SVG geometry remain present.

## Proposed fixes

| Finding | Concrete change and files | Risk | Expected gain |
|---|---|---|---|
| 1 | Maintain endpoint adjacency and dirty geometry revisions; have `smoothLineSync` react to changed relevant IDs/topology instead of serializing a whole-board signature. Replace repeated `linksOf` scans in `reflowSmoothLineAnchorsRaw` with adjacency lookups. Files: `links/smoothLineSync.svelte.ts`, `links/smoothLines.ts`, `model/links.svelte.ts`. | Keep anchor initialization, undo/redo, link restore/remove, and shared-endpoint ordering consistent. | From O(N+E+S·E) to work near the moved endpoint's incident links and affected smooth group. |
| 2 | Pass changed note IDs from geometry updates into membership sync and coalesce per frame; use a zone-bounds spatial index to find candidate zones. Let beacon rendering read the resolved membership rather than re-running polygon tests. Files: `zones/membership.svelte.ts`, note geometry update path, `beacons/BeaconsLayer.svelte`. | Preserve touch semantics, largest-area choice, tie stability, measured-height changes, and batch behavior during zone moves. | Ordinary one-note movement becomes O(1) dirty notes plus candidate zones, instead of O(N) checks and O(Z) candidate scans. |
| 3 | Keep cached paths, but store link endpoint adjacency and route AABBs; update geometry only for incident links and render a visible-link set queried by route bounds. Keep cut/marquee queries against the spatial index so culled DOM does not remove interaction. Files: `links/LinksLayer.svelte`, `links/lineGeometry.ts`, `model/links.svelte.ts`. | A route with both endpoints off-screen can cross the viewport; endpoint-only culling would hide it. Preserve selected links, arrow heads, custom dashes, and cut/marquee semantics. | Drag work approaches O(degree); SVG paths/gradients approach O(visible links) rather than O(E). |
| 4 | Use the existing cached board rect helper, and return before coordinate conversion when there is no matching link gesture or live link preview. Read the rect once per handled event. File: `links/LinksLayer.svelte` (pattern already exists in `ZonesLayer.svelte:63-65`). | Cache invalidation must cover resize/scroll/layout shifts; use the established helper's invalidation rules. | Removes an unnecessary layout read on ordinary pointermoves and avoids duplicate reads during link gestures. |
| 5 | Query a spatial note index for the preview point, preserving topmost board-order semantics. File: `links/LinksLayer.svelte` plus shared spatial index. | Index must match overlap/z-order and beacon hit-testing rules. | O(N) preview scan becomes a small local candidate query. |

## Culling / LOD contract

- Inputs: world-space viewport bounds expanded by a screen-space margin converted using current zoom; current zoom/LOD tier; stable note and zone bounds; cached route bounds; selected/focused IDs. Update visible sets once per animation frame after camera or geometry changes, and incrementally update index entries for moved objects.
- Outputs: visible node/beacon IDs; visible link IDs selected by **route AABB intersection**, not just endpoint visibility; visible zone IDs by polygon bounds; a zoom tier (`normal`, `simplified`, `minimal`). Keep full model geometry/index queries available for hit testing, search/go-to, focus, selection, and cut/marquee.
- Suggested LOD: below ~0.3 hide beacon/zone labels and simplify link ornament (arrow/dash detail); below ~0.1 render compact link/zone marks and beacon dots, with selected/focused items exempt. Do not remove interaction data when simplifying paint.
- Link layer needs viewport bounds plus route bounds: links with both endpoints off-screen may still cross the view. Zone layer needs polygon bounds and zoom tier. Beacon layer needs visible IDs, zoom tier, and selected/focused exemptions.

## Quick wins (each expected under 30 changed lines)

- Guard `LinksLayer.onPointerMove` before `localPoint`, and use one cached rect for handled link gestures.
- Hide beacon labels and zone names below the chosen LOD threshold while keeping their compact shape visible.
- Avoid repeating beacon `zoneOf` geometry work by reading the membership result already maintained by `membership.svelte.ts`.

## Structural changes

- Shared spatial indexes for note hit testing, zone candidates, and route-AABB link culling.
- Dirty-ID/revision propagation for link geometry, smooth anchors, and zone membership; remove whole-board/per-smooth-node scans from frame-sensitive work.
- Layer-level visible sets and zoom-based LOD, with model/index-based interaction independent from whether an SVG/DOM item is mounted.

## Open questions

- How many links are smooth-line affected at realistic board sizes (S and their degree distribution)? This determines the immediate cost of the `S·E` anchor path.
- How many zones and contour vertices occur on a large board, and should zones remain visible at the lowest zoom tier?
- Should cut/marquee include a link whose route crosses the gesture but whose endpoints are both off-screen? The route-AABB index can support either policy.
- Current timing needs a controlled drag profile with N/E/S/Z counts and WebView2 frame/layout instrumentation; estimates here are static only.
