PROJECT: hive — spatial board for notes (Windows desktop). Repo root C:\hive (git), app in C:\hive\app. R0–R4.5 done and accepted, installer 1.1.2. Now R4.6–R4.8: complex zone shapes (cuts, contour editor, cut-outs). You may be a fresh session: read C:\hive\docs\handoff\STATUS.md first.
Stack: Tauri 2 + Svelte 5 (runes) + TypeScript strict + Vite + Vitest. English UI. Dark compact UI.
Read first: C:\hive\ROADMAP.md section R4 (rows R4.6–R4.8, "Технические границы" §6 zones store contours; crisp rendering: never add will-change/translate3d to board layers), C:\hive\QUESTIONS_AND_IDEAS.md answers M001–M025 (zones), C:\hive\FOLLOWUP_QUESTIONS.md H19–H22, and the code you touch (src/model/zone.ts, src/zones/**).

USER DECISIONS 25.09 (binding):
- Enter shape editing: RMB on a zone → "Edit shape", or select one zone and press E. Leave: Enter or Escape — the new shape is KEPT (M024). Ctrl+Z undoes edit steps one by one. Only one zone is edited at a time.
- Zones are orthogonal: every edge horizontal or vertical.
- Hovering an edge shows where a cut would go; a click creates the cut point (M011). Extra points can't be deleted, only undone with Ctrl+Z (M015). Collinear leftover points stay while editing and disappear after leaving and re-entering (M014).
- Segment drag (H21, agreed on a sketch): perpendicular → step (inwards) or protrusion (outwards). Along (for the left side cut in half, dragging the UPPER segment): UP → the cut point stays, the top of the zone moves up as a whole; DOWN → the top stays, the cut point moves down and the lower segment shortens to the minimum.
- Corner drag moves only the two edges at the corner; Ctrl + corner drag scales the whole zone (M013).
- Minimum thickness of any part/protrusion/remaining strip: 30 u (MIN_ZONE_PART). Cut-out remnants thinner than that are removed (M018).
- Cut-out (R4.8, trial gesture H22): in shape-edit mode, drag a rectangle (marquee) and press Delete/Backspace → that area is removed from THIS zone only (M021): holes and separate parts are fine, the zone stays one zone with its name/colour (M017); nodes are never deleted or moved (M022). If nothing remains → the zone is deleted (one Undo step).
- Collisions stay: an edit can never make zones overlap by area; the edge stops at the other zone (M019/M020).
- Membership after a shape change is recomputed as today (M004/M005: nodes stay in place, join/leave).

CONTRACTS (committed by the coordinator; ask before changing their shape):
- src/zones/shape.ts — ZoneShape {parts, holes}, MIN_ZONE_PART = 30, normalizeShape, shapeArea, shapeBounds, shapeContainsPoint, shapeAreaInRect, shapesOverlap, subtractRect, pruneThin, hasThinPiece, translateShape, scaleShape. (Declared, implemented by worker A.)
- src/zones/contourEdit.ts — EditContour/ContourRing/EdgeRef/VertexRef/EdgeHit/ContourEditOptions, shapeToContour, contourToShape, hitEdge, hitVertex, insertCut, dragSegment, dragVertex, scaleByVertex. (Declared, implemented by worker B.)
- Zone {parts, holes} in src/model/zone.ts is already a ZoneShape; zones store + raw mutations in src/model/zones.svelte.ts; history execute/record (ONE Undo stack, every user action = one command); selection API; command registry (effective keys, no Tab, repeat only with repeat:true); board.json v3 already stores parts/holes.
- Occupied keys: see C:\hive\docs\handoff\r4common.md + Ctrl+T search, M / Ctrl+M marks. E is free (new: Edit shape).

RULES:
- Several workers edit C:\hive\app concurrently. Edit ONLY files listed as yours (plus new files in your area and tests in app/tests/). Need anything else → `orca orchestration ask` the coordinator.
- No git commit/config. No new dependencies (implement geometry yourself).
- Use your browser port with `npx vite --port <port> --strictPort`, stop it afterwards. Visual checks via headless Edge + CDP ("C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe" --headless=new --remote-debugging-port=<port+7900> --user-data-dir=<temp dir> …), fixtures by importing app modules in the page — see C:\hive\docs\handoff\d11smoke.mjs. No committed fixtures; delete temp files you create.
- No fake features/dead buttons; every command mouse-reachable and in F3.
- Production quality, existing style. Pure logic in .ts with Vitest tests in app/tests/.
- Verify `npm run check` and `npm test` (if an error is clearly in another worker's in-progress file, say so).
- worker_done body in Russian: what you built, how to try it by hand, what's left out, decisions to confirm. Send worker_done ONCE.
