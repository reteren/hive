PROJECT: hive — spatial board for notes (Windows desktop). Repo root C:\hive (git), app in C:\hive\app (Tauri 2 + Svelte 5 runes + TS strict + Vite + Vitest). Installer 1.5.9. This wave = the user's "debug 24" list: C:\hive\old debug message (do not touch)\debug 24md.md (read it — Russian wording is binding; never edit that file). Read C:\hive\docs\handoff\STATUS.md (top paragraph) first.

DRAWING IS NOW ON THE GPU (1.5.8, coordinator): read C:\hive\docs\handoff\d24_draw_engine.md. Key APIs:
- src/drawing/gpu/glEngine.ts — one WebGL2 context (drawingGpu()); tiles are premultiplied RGBA8 textures.
- src/drawing/history.ts — applyAcrossLevels(source, rasterX, rasterY, level, "paint"|"erase"|"under", alpha, selection?) where source is an HTMLCanvasElement / ImageData (straight alpha, uploaded for you) or a GpuRasterSource; readCompositeRect / readRasterRect (readback, use sparingly); affectedTileKeys + drawingStore.snapshot(keys) before/after + pushDrawingHistory(label, before, after) = one Undo step.
- Live stroke preview: src/drawing/stroke.svelte.ts (showStrokePreview / previewStroke), rendered by DrawingLayer.svelte in the same frame as the camera.
- Board client rect in pointer handlers: use cachedClientRect (src/board/boardRect.ts), never getBoundingClientRect per pointermove.

RULES:
- Several workers edit C:\hive\app concurrently. Edit ONLY files listed as yours (plus new files in your area and tests). Need a change elsewhere → ask the coordinator (orca orchestration ask) with the exact diff.
- Svelte runes only in .svelte / .svelte.ts. Never put a plain object you later compare by identity into $state (it becomes a proxy).
- No new npm dependencies. Don't bump @tauri-apps packages.
- Headless Edge is BLOCKED for workers — verify with code + Vitest; the coordinator does real-mouse checks. Give exact manual steps + data-attributes in worker_done.
- Production quality, existing style, one Undo step per user action, English UI, crisp at any zoom, respect html[data-reduce-motion="true"].
- Do NOT commit. Verify `npm run check` and `npm test` in C:\hive\app. worker_done body in Russian, once.
