# d42 audit tasks (read d42common.md first)

Each letter is one agent. Stay in your area; mention cross-area findings in "Open questions".

## a — Node rendering pipeline
`src/notes/NotesLayer.svelte`, `NoteNode.svelte`, `layout.svelte.ts`, `src/model/board.svelte.ts`,
`src/board/*` (camera, layers, grid, minimap/overview if any), every node body component.
Questions: are all nodes in the DOM all the time? What re-renders when ONE node moves / the camera
moves / zoom changes? Cost of `observeAutoHeight` + `measureAndCacheTextMinimumWidth` per node.
How would viewport culling (render only nodes intersecting the viewport + margin) fit, and what
breaks (measured heights of unmounted nodes, link endpoints, selection, search "go to", MCP view)?
Far-zoom LOD: what a node should become below ~0.3 / ~0.1 zoom (plain rectangle + title? nothing?).

## b — Links and zones layers
`src/links/*`, `src/links-in-text/*`, `src/zones/*`, `src/model/links.svelte.ts`, `src/model/zones.svelte.ts`,
beacons coverage (`src/beacons/*`). What is recomputed per pointermove while a node is dragged
(all link paths? smooth-line anchors? colours/gradients? zone membership for every node? beacon
coverage/focus?). SVG size and path count; markers, filters, gradients per link. Culling of links
whose both ends are off-screen; LOD for links at far zoom.

## c — Interaction hot paths (select / drag / resize / wheel / keyboard)
`src/selection/*`, `src/tools/*`, `src/commands/*`, `src/history/*`, `src/navigation/*`, `src/search/*`.
Trace one pointermove of a group drag of 50 nodes and one wheel-zoom step end to end: every
function called, every loop over all nodes, every DOM read. History: what an Undo entry captures
(whole-board snapshots?). Hit testing: how is "what is under the cursor / inside the marquee"
found — linear scan? Propose a spatial index (grid hash / R-tree) and who would use it.

## d — Drawing engine on large areas
`src/drawing/*` (WebGL2 tiles, pyramid levels, brush shader, history, png encoder, selection,
fill), Rust `src-tauri/src/drawing.rs`. Plan doc of the current engine: `docs/handoff/d24_draw_engine.md`.
Questions: cost of a stroke that crosses hundreds of tiles; tiles allocated/uploaded per stroke;
Undo snapshot size for a huge stroke; compositing cost per frame when zoomed out over a big drawn
area; save cost (PNG encode of many tiles, main thread?); GPU memory growth and eviction; what
happens at zoom 0.05 over a 50 000 × 50 000 u drawn area. Propose budgets and fixes.

## e — Persistence, autosave, watchers, change tracking, MCP
`src/project/persistence.svelte.ts` (`startBoardObserver`, `makeSnapshot`, `isDirty`,
`changedFiles`), `src/project/index.ts` (serialize), `src/changes/*`, `src/info/*`,
`src/mcp/*`, Rust `board_store.rs`, `project.rs`, `watcher.rs`, `board_watch.rs`, `backup.rs`.
Key suspicion: the board observer `$effect` serialises the whole board on every reactive change —
i.e. on every pointermove of a drag. Measure `makeSnapshot` + `isDirty` at 1k / 10k nodes with a
micro-benchmark. Also: save writes, file-watch storms after own saves, backups every 30 min on a
big project, startup/open time for 10k nodes + 10k .md files.

## f — Heavy content and per-node cost
Images/GIFs (`src/images/*`, `src/attachments/*`), PDF (`src/formats/*`, pdfjs), audio, video,
YouTube iframes, Map, Source, Tierlist, List, Calculator, Time/Message timers (`src/time/*`,
`src/messages/*`: timers per node?), CodeMirror editor (`src/editor/*`: is a CM instance or a
markdown preview with parsing alive for every node?), spellcheck (`src/spell/*`), theme/glow/
animated mark gradients (`src/markas/*`, glow box-shadows), `src/changes` marks.
For each: per-node memory and CPU at idle, off-screen behaviour, behaviour at far zoom, and what a
"thumbnail / placeholder" LOD would look like (e.g. decoded image at the size it is shown,
paused GIF/video off-screen, PDF page cache).
