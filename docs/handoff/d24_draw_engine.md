# Drawing engine rebuild (GPU) — coordinator plan, 04.10.2026

User report: big soft brush makes the PC "take off", fill can take ~30 s, the drawing "floats" (lags behind the grid) when panning fast while zoomed out. Tools and mechanics are fine; the foundation is not.

## Measured (headless Edge, 1400×900, DPR 1, version 1.5.7)
- Brush 400 px, hardness 0, wave across the screen: ~50 ms per pointermove (CPU per-pixel loop in accumulateStrokeSegment over 5 typed arrays + putImageData of the dirty rect) → ~18 fps.
- Commit of that stroke: 90–430 ms — every touched tile is read back (getImageData) and PNG-encoded twice (Undo before/after), plus getImageData per tile for "became empty" checks.
- Rendering: DrawingLayer redraws a viewport canvas on the NEXT rAF after a camera change (one frame late → the drawing visibly trails the board while panning), and it draws EVERY level's tiles with imageSmoothingQuality "high" — fine tiles have no LOD, so zoomed out it downsamples hundreds of 512² tiles per frame on the CPU path.
- Fill: readCompositeRect draws all levels into a CPU canvas + getImageData; on big regions repeated window growth multiplies it.

## New foundation
1. One WebGL2 context (the drawing layer canvas) owns ALL raster data: every tile is an RGBA8 premultiplied texture with mipmaps (LOD for free when zoomed out). No CPU copy of tiles.
2. Rendering is synchronous with the camera (same Svelte flush as the board DOM transform), not on the next rAF → the drawing is locked to the grid. Per frame: one textured quad per visible tile, coarse level first. Cost ≈ 0.
3. Stroke rasterisation on the GPU: the existing per-pixel algorithm (pass window: max within a pass, composite on a return, smooth blend ramp) is ported 1:1 to a fragment shader. Stroke state lives in stroke tiles at the working level (RGBA8: value, base, pass, blend + R32F: path position), updated by a ping-pong pass per pointer event over the event's bbox only. The CPU keeps only the smoothed path (Catmull-Rom samples).
4. Commit = GPU composite of the stroke (value × colour × opacity × selection clip) into the target tiles with blend modes (source-over at L, source-atop on existing finer tiles, destination-out for erase on all levels, destination-over for fill fringe). No readback.
5. Undo = GPU copies of the touched tiles (texture copy). A budget (≈192 tile copies) demotes the oldest copies to compressed PNG blobs in idle time, so VRAM stays bounded. The history API (snapshot / restore / pushDrawingHistory) keeps its shape.
6. Readback only where a CPU algorithm needs pixels (fill flood, selection cut, eyedropper fallback, save): readPixels of exactly the requested rect from an offscreen composite. Empty-tile pruning happens during save (pixels are read then anyway).
7. Working level picks 1–2 raster px per device px (was 1.33–2.67) → up to 4× fewer pixels per stroke.
8. Fill: flood on the visible composite of the clicked area at the working level, scanline algorithm on Uint8 alpha/colour, bounded by the viewport-plus-margin window.

Tests: pure logic stays in plain TS (path smoothing, pass-window math as CPU reference, flood fill, PNG); the GPU engine is verified in headless Edge (SwiftShader WebGL2) against the CPU reference + timing probes (docs/handoff/drawperf.mjs).
