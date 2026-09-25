PROJECT: hive — spatial board for notes (Windows desktop). Repo root C:\hive (git), app in C:\hive\app. R0–R4.5 done, installer 1.0.9 (commit c0bc01f). This wave = the user's debug/improvement list for 1.0.9. You may be a fresh session: read C:\hive\docs\handoff\STATUS.md first.
Stack: Tauri 2 + Svelte 5 (runes) + TypeScript strict + Vite + Vitest. English UI. Dark compact UI, accent = theme yellow (var(--accent)).
Read first: C:\hive\ROADMAP.md "Технические границы" (crisp rendering: never add will-change/translate3d to board layers), the R3/R4 sections relevant to your task, and the code you touch.

CONTRACTS (ask the coordinator before changing their shape): src/model/note.ts, link.ts, zone.ts; board/links/zones stores (raw mutations); history execute/record (ONE Undo stack, every user action = one command, camera never recorded); selection API (src/selection/selection.svelte.ts); command registry (effective keys; never hardcode key text in UI; no Tab; auto-repeat ignored unless repeat:true); note menu registry (src/notes/noteMenu.ts); project persistence src/project/** (board.json v3 — a new optional field is fine, keep old files loading).

RULES:
- Several workers edit C:\hive\app concurrently. Edit ONLY files listed as yours (plus new files you create in your area and tests in app/tests/). Need anything else → `orca orchestration ask` the coordinator (the coordinator owns shared seams: NoteNode.svelte, Board.svelte, App.svelte, main.ts, note.ts, board.json index).
- No git commit/config. No new dependencies.
- Use your browser port with `npx vite --port <port> --strictPort`, stop it afterwards. Visual checks via headless Edge + CDP ("C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe" --headless=new --remote-debugging-port=<port+7900> …), fixtures by importing app modules in the page — see C:\hive\docs\handoff\r4smoke.mjs. No committed fixtures.
- No fake features/dead buttons; every command mouse-reachable and in F3.
- Production quality, existing style. Pure logic in .ts with Vitest tests in app/tests/.
- Verify `npm run check` and `npm test` (if an error is clearly in another worker's in-progress file, say so).
- worker_done body in Russian: what you built, how to try it by hand, what's left out, decisions to confirm. Send worker_done ONCE; a printed JSON response means delivered.
