# d43 tasks (read d43common.md first)

Coordinator owns: `src/board/visibility.svelte.ts`, `src/board/spatialIndex.ts`,
`src/notes/NotesLayer.svelte`, `src/notes/NoteNode.svelte`, `src/notes/layout.svelte.ts`,
`src/model/board.svelte.ts`, `src/board/Board.svelte`, and a new `src/notes/NoteShell.svelte`.

## a — Per-node derived computations (the user's real lag)
Yours: `src/progress/*`, `src/stats/*`, `src/scope/*`, `src/modules/moduleActions.svelte.ts`,
`src/modules/moduleLogic.ts`, `src/markas/markasLogic.ts`, `src/messages/resolution.ts`,
`src/messages/MessageNodeBody.svelte`, `src/time/*`, `src/map/*`.
1. **Progress first** (measured #1): a Progress node must not recompute while nodes are only being
   moved. Its result depends on task state, importance and scope membership — not on x/y. Make the
   summary depend on a cheap revision of exactly those inputs (per scope), cache it, and recompute
   only when they change. Same for Statistics (`stats/*`) and list statistics.
   `listStatisticsWidth`/`widthWithListStatistics` are called O(N) per move from `noteBounds`:
   make them O(1) with no reactive fan-out for non-List notes.
2. Module/mark styling (`effectiveImportance`, `effectiveCustomMarkFrameColors`, purposes, moods):
   no scan of all links per note — use `linksOf` (O(degree) after agent b) and memoise per note.
3. Message/Time: `messageTextFieldState` and Time task-link lookups via `linksOf`, not all links +
   board order. Replace the per-Time-body 1 s `setInterval` with one shared clock. The scheduler
   (`time/runtime.svelte.ts`) must not scan the whole board every second — keep a set of notes that
   have schedules, updated through `onBoardMutation`.
4. Map: one shared map frame/snapshot for all Map nodes, rebuilt at most once per animation frame
   and only when board geometry/camera revision changed; no `JSON` cache keys of the whole board.
Measure with the real-like case: 224 notes incl. 7 Progress, 9 zones, while one note is dragged.

## b — Links, zones, beacons, overview
Yours: `src/links/*`, `src/links-in-text/*`, `src/zones/*`, `src/beacons/*`, `src/overview/*`,
`src/model/links.svelte.ts`, `src/model/zones.svelte.ts`.
1. Adjacency in `model/links.svelte.ts`: `linksOf` O(degree), kept in sync on every link add/remove/
   replace/restore (contract for other agents — do this first and keep the signature).
2. Zone membership: dirty-id driven (`onBoardMutation` + measured height changes) with a zone-bounds
   index; no full-board scan per drag frame. Beacons read the resolved membership instead of
   re-running polygon tests. Keep tie rules exactly.
3. LinksLayer: recompute geometry only for links incident to changed notes; render only links whose
   route AABB intersects `visible.rect` (plus selected/hovered/being-cut links). Guard
   `onPointerMove` before any `getBoundingClientRect` (use the cached board rect helper).
4. Smooth lines: dirty-driven sync, no whole-board geometry signature; use adjacency.
5. LOD: below the `simple` tier hide beacon/zone labels and link ornaments (arrows/dash detail) except
   selected/focused; `min` tier draws links as plain thin lines.
6. Alt overview (`overview/*`): only visible items, no full rebuild per camera change.
Until `visibility.svelte.ts` lands, compute the visible world rect from `camera`/`viewport` in a small
local helper and swap to `visible.rect` when the coordinator tells you.

## c — Interaction + Rust persistence backend
Yours: `src/selection/*`, `src/tools/*`, `src/commands/*`, `src/search/*`, `src/navigation/*`,
the drop-target parts of `src/list/ListBody.svelte` and `src/tierlist/TierlistBody.svelte`, and in Rust
`board_store.rs`, `project.rs` (save/load paths), `board_watch.rs`, `watcher.rs`, `backup.rs`.
1. Rust first: save planner must not read/pretty-print every object file on each save — keep the
   last synced bytes/fingerprints in memory and plan only changed objects; incremental `_order`
   (no O(N²) in `assign_orders`). The board watcher must recognise its own writes without a full
   board reload; drawing watcher hashes only changed tile paths. Project open must not read every
   Markdown twice (seed the note watcher with the hashes from the load). Backup: no full fingerprint
   walk when nothing changed since the last snapshot. Measure open/save on a 3000-node project
   (generate one under your temp dir; never use a real project).
2. Frontend interaction quick wins from `d42_audit_c.md`: skip drop-target preview for multi-note
   drags; model-bounds rejection before DOM rect reads in List/Tierlist targets; selected-card
   lookup by id at drag start; selection outlines only for visible selected notes; search/Objects
   panel incremental normalized index.
3. When the coordinator announces `visibility.svelte.ts`: switch `hitTesting.ts` (Alt-click,
   marquee) to `queryPoint`/`queryRect` + exact tests + paint-order sort.

## d — Drawing on large areas
Yours: `src/drawing/*`, `src-tauri/src/drawing.rs`.
Implement the audit d plan, priority order: (1) stroke commit and capture by exact touched tile keys,
never by enumerating the stroke's bounding rectangle; no silent no-op above the 100 000-cell guard;
(2) far-zoom render: per frame draw only the levels that matter at the current zoom (with a coarse
composite fallback so marks only on finer levels stay visible), batch quads, no per-frame scan of
every populated level; (3) bounded transient GPU memory for long strokes; (4) GPU residency budget
with eviction + incremental tile load on open/pan; (5) Undo snapshots and save readback/PNG encode
proportional to touched area, not blocking a frame for long (`allKeys()` sort quick win too).
Measure stroke/commit/frame times with a throwaway in-page probe or unit benchmarks; report numbers.

## e — Frontend persistence, change marks, Info, MCP
Yours: `src/project/persistence.svelte.ts`, `src/project/index.ts`, `src/changes/*`, `src/info/*`,
`src/mcp/*`, `src/backup/*`.
1. `startBoardObserver` must not serialise the whole board on every reactive change. Track dirty
   note ids via `onBoardMutation` (+ links/zones/trash/archive/taskLog/calculators revisions from their
   modules — read-only use, ask if a module lacks a cheap revision), schedule the debounced save, and
   build the snapshot only at save time, re-serialising only changed records (cache serialized
   records by id + revision). `isDirty`/`changedFiles` must be O(changed). Close-flush and export stay
   complete and correct. Text edits must still save (check how the editor writes `note.text`).
2. Change marks: `recordOwnSave` gets changed ids; no full fingerprint pass after each save.
3. Info window: direct lookups (file map by id, links via `linksOf`, task log by id).
4. MCP quick wins from audit e (#7, #8): adjacency for `linkedTo`, direct id lookup in `nodes.get`,
   one-pass membersByZone for `board.overview`.
Measure `makeSnapshot`/`isDirty` per drag move before/after at 1k and 10k (your audit harness).

## f — Heavy content per node
Yours: `src/images/*`, `src/attachments/*` (display/decoding side, not import formats),
`src/formats/*`, `src/audio/*`, `src/video/*`, `src/youtube/*`, `src/editor/MarkdownPreview.svelte`,
`src/editor/markdown.ts`, `src/list/*` and `src/tierlist/*` (except the drop-target code owned by c),
`src/modules/modules.css`, `src/notes/noteGlowLogic.ts`.
1. Images: display a decoded copy at the size it is shown (e.g. `createImageBitmap` with
   `resizeWidth`, or cached downscaled thumbnails per attachment and size bucket ≤ 2× on-screen px),
   original only when large on screen; transparency probe on a small thumbnail, cached per file.
   GIFs: static still when not visible/selected per the existing settings.
2. Media: `preload="none"` until intent; one shared window pointer listener for video/YouTube
   gestures; YouTube thumbnails/metadata deduplicated by video id and deferred until near the
   viewport; playing media pins its note (`pinNote`) so it is not culled mid-playback.
3. PDF: open the document only when the note is visible; virtualise page placeholders. Format nodes:
   CodeMirror only while edited/selected, otherwise a light read-only preview.
4. MarkdownPreview: visibility hysteresis that can return to "not visible"; skip link parsing for
   off-screen previews; cache parsed results by text.
5. Long List/Tierlist virtualisation where cheap; tierlist video-frame cache LRU-bounded.
6. Decorations: animated mark gradients and glow blur paused/simplified when `lod.tier !== "full"`.
