PROJECT: hive — spatial board for notes (Windows desktop). Repo root C:\hive (git), app in C:\hive\app (Tauri 2 + Svelte 5 runes + TS strict + Vite + Vitest; Rust in app/src-tauri/src). Installer 1.5.6. This wave = the user's "debug 23" list: C:\hive\old debug message (do not touch)\debug 23.md (read it — the original Russian wording is binding; never edit that file). You may be a fresh session: read C:\hive\docs\handoff\STATUS.md (top paragraph) first.

DRAWING CONTEXT (R10, done by the coordinator): draw mode Ctrl+D (tool.active === "draw"); raster tiles in a resolution pyramid (keys "L:col:row", src/drawing/types.ts, tileStore.svelte.ts, history.ts); sub-tools brush/eraser/fill/select-rect/select-lasso/select-polygon registered via src/drawing/toolRegistry.ts and routed by src/drawing/drawInput.ts; one Undo entry per action via pushDrawingHistory (history.ts). Hotbar sub-tools: src/ui/LeftToolbar.svelte (coordinator owns it).

RULES:
- Several workers edit C:\hive\app concurrently. Edit ONLY files listed as yours (plus new files in your area and tests). If you need a change in someone else's file, ask the coordinator (orca orchestration ask) with the exact diff you need.
- Svelte runes ($state/$derived/$effect) ONLY in .svelte / .svelte.ts files (tests/runesPlacement.test.ts enforces it).
- Tauri JS packages must stay on the Rust crates' minor versions (@tauri-apps/api ~2.11) — never bump them. No new npm dependencies. New Rust crates only if your task allows it.
- Headless Edge is BLOCKED for workers — verify with code + Vitest (+ cargo test); the coordinator does real-mouse checks. Give exact manual steps + data-attributes in worker_done.
- Production quality, existing style, one Undo step per user action, English UI, crisp rendering, no dead buttons, respect html[data-reduce-motion="true"].
- Do NOT commit — the coordinator commits.
- Verify `npm run check`, `npm test` (and `cargo test` if you touched Rust) in C:\hive\app.
- worker_done body in Russian, once.
