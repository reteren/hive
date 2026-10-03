R10 delivery 1 = R10.1 brush · R10.2 eraser + presets · R10.3 fill · R10.4 selection (03.10, after 1.5.0).
The user is waiting eagerly. Quality bar: smooth (60 fps on a big board) and no lost work.

Common rules are as in C:\hive\docs\handoff\d8common.md:
- headless Edge is blocked for workers; the coordinator tests with a real mouse;
- runes only in .svelte/.svelte.ts;
- send worker_done once, in Russian, and check that the send returned ok;
- `npm run check` + `npm test` must be green; for Rust also `cargo test` (CARGO_TARGET_DIR=C:/hive/app/src-tauri/target-alt).

Five tasks run in parallel in C:\hive:
- Stay in your own files.
- Shared files: small isolated hunks, named in your report. Re-read the file right before editing and commit shared hunks immediately.
- Run `git diff --cached --stat` before every commit, and commit ONLY your files.
- Never rewrite history. No attribution. Ask when unsure.

READ FIRST: app/src/drawing/types.ts (the contract, commit after 1.5.0). It sets:
- the raster tile layer, 20 px/u, 512-px tiles;
- the tile key format;
- the persistence layout `drawing/tiles/<col>_<row>.png` + `drawing/drawing.json`;
- the undo by tile snapshots;
- brush settings and screen-px brush size;
- the accumulation rule;
- the layer order: above zones, below links/beacons/nodes;
- the DrawingTileStore API.
ToolId gained "draw".

ROADMAP R10 acceptance (ROADMAP.md lines ~259-275):
- The 10-px brush cursor stays 10 px at any zoom; drawing from far away makes a thicker line on the board.
- A repeated pass strengthens the trace; holding the pointer still does not.
- The eraser affects only drawings and photos, never nodes, zones or links.
- Fill fills inside a closed drawn shape; clicking empty infinite board does not fill the field or a zone.
- Selection: only the selected piece moves, not the whole stroke. Handles change the selection area (M182). Text nodes are not captured.
- Every action is one Undo step.

TASK CORE — R10.1 engine. Files:
- new src/drawing/tileStore.svelte.ts (implements DrawingTileStore);
- src/drawing/DrawingLayer.svelte (renders visible tiles);
- src/drawing/brush.ts (stroke rasterisation);
- src/drawing/history.ts (one undo entry per action using snapshot/restore);
- src/drawing/persistence.svelte.ts (load on project open, debounced save; talks to the PERSIST commands);
- a small hunk in src/board/Board.svelte to mount DrawingLayer between ZoneBrushLayer and LinksLayer;
- tests.
1. The tile store keeps tile canvases in memory. revision is a $state counter. commit():
   - checks whether a tile is fully transparent (sample cheaply; a full scan of a 512² alpha is fine once per commit) and drops it;
   - bumps revision;
   - asks persistence to save.
2. DrawingLayer draws only the tiles intersecting the viewport (plus a margin), as absolutely positioned <canvas> elements in world space inside the board's world transform (like other layers). They are pointer-events: none, with no per-frame work while idle.
3. Brush stroke:
   - Pointer events come from TASK TOOLS (it calls `beginStroke(settings, worldPoint, zoom)`, `extendStroke(worldPoint, pressure?)`, `endStroke()` exported from brush.ts or a stroke module).
   - Width in world units = size / (10 × zoom), fixed for the whole stroke at begin.
   - Interpolate points (no gaps on fast moves) with round caps.
   - Hardness → a radial gradient edge.
   - Paint into a temporary stroke canvas covering the stroke bbox at raster density, using max-alpha so overlapping within the stroke does not accumulate.
   - Show a live preview while drawing (the temp canvas positioned in world space).
   - On end: composite it with the stroke opacity into the affected tiles (source-over), take the undo snapshot (before: snapshot the tiles at stroke begin, lazily per touched tile), commit, and push ONE history entry ("Draw").
4. Export a compositing helper `paintIntoTiles(sourceCanvas, rasterOrigin, mode: GlobalCompositeOperation, alpha)`, which ERASE/FILL/SELECT reuse.
5. Performance: no full-board redraws; while drawing, only touched tiles are updated, and only on pointer-up. 60 fps preview on a 1920×1080 viewport.
Tests: the width math, the interpolation, the max-alpha rule (the same pixel twice in one stroke = single alpha; two strokes = accumulated), snapshot/restore round-trip, and transparent-tile pruning (use node-canvas-free logic tests: abstract the pixel math into pure functions over Uint8ClampedArray).

TASK PERSIST — Rust + backup/export. Files:
- new src-tauri/src/drawing.rs (+ registration hunk in lib.rs);
- small hunks in backup.rs and export.rs so `drawing/` is included in snapshots, restore and export/import zip like `notes/`;
- the health check reports tiles listed in drawing.json but missing;
- Rust tests.
Commands:
- `drawing_load() -> { index: DrawingIndex | null }`;
- `drawing_read_tile(key) -> Vec<u8>` (PNG bytes; validate the key format);
- `drawing_save(changes: [{ key, png: Vec<u8> | null }], index: DrawingIndex)` — atomic per file (temp + rename), deletes tiles mapped to null, then writes drawing.json last.
Validate:
- PNG magic;
- the size limit per tile (e.g. 4 MB);
- that keys are integers within ±10^7.
Never follow symlinks. Use the same fingerprint approach as notes for backups — the tiles are mutable, so content is included, but they are small.
Also the TS side: `src/drawing/api.ts`, thin invoke wrappers with a browser fallback (in-memory), so the coordinator's smoke tests work in vite dev. Land api.ts first, as its own commit, and notify the coordinator.

TASK TOOLS — R10.1 UI + R10.2 presets panel. Files:
- new src/drawing/tools.svelte.ts (active DrawTool, brush/eraser settings, presets persisted with view settings);
- src/drawing/DrawToolbar.svelte (left panel shown while in draw mode);
- src/drawing/DrawCursor.svelte (screen-constant circle cursor of the brush size);
- src/drawing/drawInput.ts (pointer handling in draw mode → CORE/ERASE/FILL/SELECT functions);
- small hunks:
  - command registration: Ctrl+D toggles draw mode (tool.active = "draw"); Esc returns to select;
  - LeftToolbar entry;
  - settings persistence for presets;
- tests.
1. Ctrl+D toggles draw mode. In draw mode:
   - left-drag draws with the active tool;
   - middle-drag / WASD / wheel still pan and zoom, as everywhere;
   - nodes and links are not selected or dragged.
   - Right-click opens nothing for now; R10.8 later uses RMB for the eyedropper, so keep RMB free.
2. Left panel (compact, app style, white/neutral controls): tool buttons:
   - Brush (B);
   - Eraser (E);
   - Fill (G is taken — use F);
   - Select rect (M) / lasso (L) / polygon (P) — only while draw mode is active, so they don't clash with the board keys; check the existing keymap and avoid conflicts.
   Plus: a colour swatch with a picker (a hex input + a small palette), size (1–400 screen px, slider + number), opacity and hardness sliders (MediaSlider), and presets: save the current settings as a preset, click to apply, delete. Presets persist with the view settings.
3. The cursor is a circle of exactly `size` screen px at any zoom. Eraser shows a dashed circle; fill shows a bucket glyph cursor.
4. `[` / `]` change the size.
Tests: shortcuts mapping, preset persistence, cursor size independent of zoom, and no conflicts with existing keys.

TASK ERASEFILL — R10.2 eraser + R10.3 fill. Files: new src/drawing/eraser.ts, src/drawing/fill.ts, an image copy-on-write helper in src/drawing/photoErase.ts, tests.
1. Eraser:
   - The same stroke machinery as the brush (reuse CORE's stroke API with mode "erase", destination-out), hardness/size/opacity apply.
   - It affects the drawing tiles and PHOTOS: image nodes, including GIF first frames — no, GIFs are excluded: say "Eraser does not affect GIFs" in a tooltip.
   - Photos are immutable attachments: erasing on an image node produces a NEW attachment (PNG with alpha) and repoints the node at stroke end. Same aspect, natural size; respect flipX/flipY and the node's world rect → image pixel mapping.
   - One undo entry restores the previous image ref and the tiles together.
   - Never touches nodes of other kinds, zones or links.
2. Fill:
   - A click flood-fills the region of the DRAWING raster that contains the point. Matching is by colour with a tolerance (default 24), with the boundary formed by drawn pixels.
   - The fill must NOT leak to infinity: compute the region within a bounded window around the click (the union of tiles within e.g. 4096 px). If the region touches the window border, it is open: do nothing and show a small hint, "Fill needs a closed shape" (roadmap: a click on empty board does not fill the field or a zone).
   - Fill uses the current brush colour/opacity, and adds a 1-px expansion under the anti-aliased boundary to avoid gaps.
   - One undo entry.
Tests: a closed square fills inside only; an open shape does nothing; tolerance; the photo copy-on-write mapping math, including flip; the eraser never affects non-image nodes.

TASK SELECT — R10.4 selection. Files: new src/drawing/selection.svelte.ts, src/drawing/SelectionOverlay.svelte, tests.
1. Tools:
   - Rectangle: drag.
   - Lasso: freehand.
   - Polygon: click points, double-click/Enter to close.
   They select pixels of the DRAWING raster only. Nodes and text are never captured (roadmap). Photos are not included in R10.4.
2. With an active selection:
   - drag inside it moves the selected piece: cut on the first move, show it floating, paste on commit;
   - Ctrl+drag copies;
   - Delete/Backspace deletes the selected pixels;
   - Ctrl+C / Ctrl+V copy/paste the piece within the drawing (internal clipboard is fine), with paste at the pointer;
   - Esc or a click outside commits and deselects.
   - Marching-ants outline.
   - Handles on the selection bounds resize the selection AREA (M182), not the pixels — scaling pixels can come later. Ask if M182 in docs/ says otherwise: grep the repo docs for M182 first.
3. Each committed action (move, copy, delete, paste) is ONE undo entry via CORE's history helper.
Tests: the mask from rect/lasso/polygon, a move that only shifts the selected pixels (the rest of the stroke stays), delete, copy, undo.

Coordination:
- CORE exposes brush.ts/history.ts/tileStore early: commit a skeleton API first and notify the coordinator.
- PERSIST lands api.ts first.
- Others code against the contract and the announced APIs. Until those land, local stubs are fine but must not be committed.

Reports: one worker_done per task, covering what changed, the shared hunks, and how to check by hand.
