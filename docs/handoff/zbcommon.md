PROJECT: hive — spatial board for notes (Windows desktop). Repo root C:\hive (git), app in C:\hive\app. R0–R4 done (installer 1.1.3). The user rejected the R4.6–R4.8 "Edit shape" zone editor (inconvenient and broken). This wave REPLACES it with a zone BRUSH. You may be a fresh session: read C:\hive\docs\handoff\STATUS.md first.
Stack: Tauri 2 + Svelte 5 (runes) + TypeScript strict + Vite + Vitest. English UI. Dark compact UI, accent = theme yellow.

USER SPEC 25.09 (binding):
- Zone tool (Z) active: LMB = square brush that paints zone; RMB = eraser of the same size. Ctrl+LMB drag = rectangle to paint; Ctrl+RMB drag = rectangle to erase.
- LMB pressed on EMPTY board → the stroke creates a NEW zone. LMB pressed INSIDE a zone → the stroke extends THAT zone. Paint never overlaps other zones (clipped against them). Same rule for Ctrl+LMB rectangles.
- Eraser (brush or Ctrl+RMB rectangle) erases EVERY zone under it. A zone erased completely is deleted; a zone cut in pieces stays one zone (several parts / holes). Nodes are never moved or deleted.
- Brush squares snap to a 10 u grid. Brush size 20…300 u in steps of 20. Ctrl + mouse wheel (in zone tool) changes the size by one step per notch.
- While the zone tool is active, a small rounded square panel appears bottom-left with: (1) a field showing the current size, (2) "+", (3) "−". +/− change by 20. Click the field → type a size: only multiples of 20, max 300, no 0 — a value not a multiple of 20 auto-corrects to the nearest multiple (clamped to 20…300) on Enter/blur. Hovering the field and turning the wheel (no Ctrl) also changes the size.
- Minimum thickness of any zone piece is now 20 u (thinner leftovers after erase/clipping are removed).
- The old Edit shape editor is REMOVED completely (E key, RMB "Edit shape", cut points, segment/corner drags, marquee cut-out). The old drag-a-rectangle zone creation is replaced by Ctrl+LMB rectangles.
- Every finished stroke / rectangle = ONE Undo step (paint may change one zone; erase may change/delete several). Membership recomputes as today.

CONTRACTS (committed by the coordinator; ask before changing their shape):
- src/zones/brush.ts — BRUSH_MIN/MAX/STEP/GRID, ZONE_MIN_THICKNESS=20, normalizeBrushSize, brushSquare, brushSegmentShape, unionShapes, subtractShapes, paintStroke, eraseStroke (declared; worker A implements).
- src/zones/brushState.svelte.ts — brushState.size (worker C owns setters/persistence).
- src/zones/shape.ts — existing shape engine (normalizeShape, shapesOverlap, subtractRect, pruneThin(minPart), translateShape …). Reuse it; keep its API.
- Zones store src/model/zones.svelte.ts (raw add/remove/update/replace), history execute/record (ONE Undo stack), command registry (effective keys, no Tab), tool state src/tools/tool.svelte.ts.

RULES:
- Several workers edit C:\hive\app concurrently. Edit ONLY files listed as yours (plus new files in your area and tests in app/tests/). Need anything else → `orca orchestration ask` the coordinator.
- No git commit/config. No new dependencies.
- Use your browser port with `npx vite --port <port> --strictPort`, stop it afterwards. Visual checks via headless Edge + CDP with a temp --user-data-dir, fixtures by importing app modules in the page — see C:\hive\docs\handoff\r46smoke.mjs. Delete temp files you create.
- No fake features/dead buttons; every command mouse-reachable and in F3. Keep crisp rendering (no will-change/translate3d on board layers).
- Production quality, existing style. Pure logic in .ts with Vitest tests in app/tests/.
- Verify `npm run check` and `npm test` (if an error is clearly in another worker's in-progress file, say so).
- worker_done body in Russian: what you built, how to try it by hand, what's left out, decisions to confirm. Send worker_done ONCE.
