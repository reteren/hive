PROJECT: hive — spatial board for notes (Windows desktop). Repo root C:\hive (git), app in C:\hive\app. R0–R3 done and accepted (installer 1.0.8). Now phase R4: beacons and zones on one plane. You may be a fresh session: read C:\hive\docs\handoff\STATUS.md first.
Stack: Tauri 2 + Svelte 5 (runes) + TypeScript strict + Vite + Vitest. English UI. Dark compact UI (final visual design comes later — keep it clean and consistent).
Read first: C:\hive\ROADMAP.md section "R4" incl. "Решения пользователя 24.09 перед R4" (binding), "Технические границы" (esp. crisp rendering: never add will-change/translate3d to board layers; §6 zones store contours), C:\hive\QUESTIONS_AND_IDEAS.md answers M001–M025 and M053–M066, C:\hive\FOLLOWUP_QUESTIONS.md H19–H25, and the code you touch.

R4 CONTRACTS (committed; ask the coordinator before changing their shape):
- src/model/note.ts: NoteKind includes "beacon" (fixed circle BEACON_SIZE = 7.2 u; `color` hex; name). Note.zoneId?: string|null (membership memory for ties).
- ME: permanent beacon with id "me" (ME_OBJECT_ID in src/model/link.ts), drawn by src/board/MeMarker.svelte, not a note; never moved/deleted.
- src/model/zone.ts (Zone {id,name,color,parts: Point[][], holes: Point[][]}; rectContour, zoneBounds), src/model/zones.svelte.ts (zones.byId/order + raw add/remove/update/replace). Zones are drawn BELOW links and notes.
- src/zones/membership.svelte.ts: zoneOf(objectId), zoneMembers(zoneId) — stub, implemented by the zones-core worker.
- src/beacons/coverage.ts: beaconDescendants(beaconId) — stub, implemented by the beacons worker (strong outgoing links only, visit once).
- src/beacons/beaconState.svelte.ts: beaconState.focused / .marked.
- src/tools/tool.svelte.ts: ToolId includes "zone".
- Layers mounted in src/board/Board.svelte: ZonesLayer (src/zones), BeaconsLayer (src/beacons).
- Existing: board store + raw mutations, links store (removeLink/addLink have lifecycle listeners), history execute/record (ONE Undo stack, every user action = one command), selection API (src/selection), command registry (effective keys; never hardcode key text; no Tab; auto-repeat ignored unless repeat:true), note menu registry (src/notes/noteMenu.ts), navigate.ts teleports, project persistence src/project/** (board.json v2), settings src/settings/**.
- Occupied keys: Space, Home, =/-, Ctrl+0, Shift+G, Alt+S, [ ], N, Q, G, T, C, V, 1, F2, F3, Shift+T, Shift+Alt+T, Ctrl+Shift+K, Ctrl+Z/Y/Shift+Z, Ctrl+Alt+Z, Ctrl+C/X/V, Delete/Backspace, Shift+D, Ctrl+O, Ctrl+Shift+N, Alt+O, Alt+←/→, Ctrl+Comma, WASD, editor Ctrl+B/I/E/1, Ctrl+Shift+H. Reserved: Ctrl+D (drawing). R4 takes: Ctrl+G (focus), Ctrl+F (select beacon group), Ctrl+I (beacon menu), M / Ctrl+M (mark), Space (go to marked, else ME).

RULES:
- Several workers edit C:\hive\app concurrently. Edit ONLY files listed as yours; need anything else → `orca orchestration ask` the coordinator.
- No git commit/config. Dependencies only if allowed.
- Use your browser port with `npx vite --port <port> --strictPort`, stop it afterwards. Visual checks via headless Edge + CDP ("C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe" --headless=new --remote-debugging-port=<port+7900> …), fixtures by importing app modules in the page — see C:\hive\docs\handoff\r3smoke2.mjs for an example. No committed fixtures.
- No fake features/dead buttons; every command mouse-reachable and in F3.
- Production quality, existing style. Pure logic in .ts with Vitest tests in app/tests/.
- Verify `npm run check` and `npm test` (if an error is clearly in another worker's in-progress file, say so).
- worker_done body in Russian: what you built, how to try it by hand, what's left out, decisions to confirm. Send worker_done ONCE; a printed JSON response means delivered.
