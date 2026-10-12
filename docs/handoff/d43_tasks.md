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

## d2 — Drawing, part 2 (after d43_report_d.md)
Same files as d. Priority:
1. **No missing pixels, ever.** Today a viewport needing more than 96 tiles loads only 96, so parts of a
   big drawing vanish at far zoom. Visible content must always be drawn: the residency budget may evict
   off-screen tiles only; at far zoom the renderer must use coarse data so the number of tiles it needs
   stays bounded (≈ viewport / tile size per level) instead of loading hundreds of fine tiles.
2. **Coarse composite cache**: keep/maintain coarse-level tiles that contain the composite of finer
   levels (rebuilt incrementally when a finer tile changes, off the input path), so zoom 0.05 over a huge
   drawing draws a handful of coarse tiles, not every level. Preserve the coarsest→finest composition
   rules when zoomed in.
3. Bounded transient GPU memory for long strokes (byte budget; spill/commit finished sections while
   keeping one Undo step).
4. Quad batching only if draw calls still matter after 1–2 (measure first).
Verify with an in-test or vite-node probe: a 50 000 × 50 000 u drawing at zoom 0.05 / 0.3 / 1 — tiles
loaded, tiles drawn per frame, GPU bytes resident. Report in `d43_report_d2.md`.

## a2 — Bulk import and bulk creation ("drop half of drive C into hive")
Yours (agent f keeps the display side of these folders): `src/formats/boardFileDrop.ts`,
`src/formats/formatActions.ts`, `src/formats/formatCreation.ts`, `src/formats/textDrop.ts`,
`src/images/imageActions.ts`, `src/audio/audioActions.ts`, `src/notes/creationPosition.ts`,
`src/clipboard/commands.ts`, `src/clipboard/payload.ts`, Rust `attachments.rs` (import side),
`text_import.rs`.
Scenario: the user drops a folder (or selects) 5 000–50 000 files (images, PDFs, text, audio, video)
or pastes 5 000 copied nodes onto a board that already has 20 000 nodes.
1. Placement: free-spot search must use the spatial index (`queryRect` from
   `src/board/visibility.svelte.ts`) instead of building obstacles from every note
   (`creationObstacleForNote` over `Object.values(board.notes)` is O(N) per created node → O(N·M)).
   Bulk placement lays the batch out as a grid/flow in one pass.
2. Import pipeline: streamed and batched (e.g. 200 files per batch), never one giant synchronous
   loop; Rust copies/hashes attachments off the UI thread with progress events; the UI shows progress
   and stays responsive; cancel keeps what is already imported. Whole import = ONE Undo step.
3. Node creation in bulk: one `replaceBoard`/batched add instead of thousands of reactive inserts
   where possible; no per-node history entries; autosave sees one change burst.
4. Paste of thousands of nodes: same rules (placement + one Undo step + batched).
Measure with throwaway harnesses (time to place/import 5 000 items into a 20 000-node board, main-thread
blocking per batch). Report `d43_report_a2.md`.

## e2 — Delta saves (after d43_report_e.md)
Today a save still builds and sends the whole 2.4 MB index JSON at 10k notes (52 ms deferred) and Rust
re-parses/validates it all. Storage is already one file per object, so a save can be O(changed):
1. Frontend sends a **delta**: changed/added object records per collection (notes, links, zones, trash,
   archive, taskLog, calculators, head fields) + deleted ids + changed Markdown bodies, with the board
   revision. Full saves stay for project creation/migration/export/recovery.
2. Rust applies the delta: writes/deletes only those object files (atomic per file, same safety rules:
   no deleting objects that arrived from a pull, stale-revision refusal, rename/collision checks for
   note files), updates the in-memory synced document incrementally.
3. Rust files `project.rs` (save path) and `board_store.rs` become yours **after agent c reports done**
   (the coordinator tells you); start with the frontend side and the request format.
4. Also route `attachments/gifPlayback.svelte.ts` `gifStopped` write through `updateNote` (approved).
Measure: one-note drag then save on a 10k board — frontend ms, IPC bytes, Rust ms. Report `d43_report_e2.md`.

## d3 — Drawing: bounded long-stroke memory (after d43_report_d2.md)
Long strokes still keep two ping-pong buffers per touched tile until the stroke ends. Add a byte budget
for transient stroke state; when exceeded, commit/spill finished sections (tiles the brush has left) so
GPU memory stays bounded, while the whole stroke remains ONE Undo step and the soft-brush pass rules
(no double darkening at joints/returns) still hold across the spill boundary. Measure with a synthetic
stroke across 300+ tiles at zoom 0.05 and 1. Report `d43_report_d3.md`.

## b2 — Far-zoom canvas layer (after d43_report_b.md)
Measured on the integrated build, 20 000 notes at zoom 0.03 (`min` tier): 16 186 NoteShell DOM nodes,
switching into the tier takes 1.7 s and panning runs at 37 ms/frame. At `min` tier the board must be
drawn like a game minimap: ONE canvas, no per-object DOM.
Yours: a NEW `src/board/FarLayer.svelte` (+ helpers in `src/board/far*.ts`), plus your own layers
(`links/*`, `zones/*`, `beacons/*`) so they render nothing in DOM at `min` tier except selected/focused/
being-edited objects. The coordinator wires NotesLayer (at `min` only pinned notes stay in DOM) and
mounts FarLayer in `Board.svelte` when you report done; agent c adds a SelectionLayer fallback so a
press on an empty DOM point at `min` tier picks the top-most note via `queryPoint`.
1. FarLayer draws, for `visible.rect` (use `queryRect` on the shared spatial index for notes, your
   route index for links, your zone index for zones): notes as filled rectangles in their frame/body
   colours (kind colours as in `notes/noteKinds.css`, node colour overrides, done tasks dimmed),
   images as their decoded small bitmap when agent f's display cache has one (read-only use of
   `src/attachments/displayBitmap.ts`) else a grey box, links as 1 px lines (weak dashed if cheap),
   zones as translucent fills + outline, beacons as dots in their colour. Device-pixel-ratio aware.
2. Redraw on camera change in the same frame (no lag behind the DOM layers), on model changes coalesced
   to one redraw per frame. Budget: 20 000 visible notes + 5 000 links ≤ 6 ms per redraw in a
   throwaway micro-benchmark (OffscreenCanvas or canvas in vitest+jsdom is not representative — use a
   node canvas-free benchmark of your draw-list building + note the draw-call count; the coordinator
   measures in the app).
3. Pan without rebuilding draw lists: keep world-space draw lists, rebuild them only when visible.rect
   or the model changes; per frame just set the transform and replay.
4. Selected notes are drawn by the DOM layer on top; FarLayer skips them.
Report `d43_report_b2.md`.

## c2 — Pressing nodes that are drawn on the far canvas
Yours: `src/selection/*`. At `lod.tier === "min"` agent b's FarLayer draws notes on one canvas, so most
notes have no DOM element. When a select-tool press (or double-click, context menu, Alt/Ctrl variants)
lands on no `[data-note-id]` element at `min` tier, find the top-most note under the cursor with
`queryPoint(world)` + exact bounds + paint order (you already have this for Alt-click) and behave exactly
as if the press hit that note's header: select, move-candidate drag, Ctrl/Alt rules, right-click opens the
note menu for it. Presses on empty space keep their current behaviour (marquee etc.). Add tests for the
decision logic. Report `d43_report_c2.md`.

## f2 — Regression review of the whole wave (read-only)
Review `git diff 848349d..HEAD -- app/` (the d43 wave) for **behaviour regressions**, not style:
things that worked before and may now break — stale caches (a summary/membership/link geometry not
updated after undo/redo, pull from Git, paste, MCP write, replaceBoard, trash restore, archive restore),
culled notes (unmounted bodies losing state: timers, playing media, editing, scroll position, combo
sections, inbox twins), far-zoom shells (double-click, context menu, drag, tooltips), autosave dirty
tracking that misses a write path (direct field writes on boarded notes), Rust save/watch changes that
could skip writing or miss a pull, search index drift. For every finding: file:line, the concrete
scenario, why it breaks, suggested fix. Do not edit code. Write `d43_review_f2.md` (ranked, most
severe first), then worker_done.

## f3 — Fix review findings 1 and 4 (d43_review_f2.md)
Yours: `src/audio/*`, `src/formats/PdfNodeBody.svelte` (+ a small module for remembered PDF scroll).
1. Dictaphone: pin the note (`pinNote`) from requesting/recording/saving until capture ends, so its Stop
   button can never be culled. The coordinator makes every pinned note keep its FULL body at any LOD.
2. PDF: remember scroll position per note id outside the component and restore it on remount
   (after the document/page sizes are known), so culling/LOD swaps do not reset it.
Tests for the pin lifecycle and the scroll memory. Report `d43_report_f3.md`.
