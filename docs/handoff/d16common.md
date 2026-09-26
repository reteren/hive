PROJECT: hive — spatial board for notes (Windows desktop). Repo root C:\hive (git), app in C:\hive\app. R0–R5 done, installer 1.1.6. This wave = the user's debug list for 1.1.6. You may be a fresh session: read C:\hive\docs\handoff\STATUS.md first.
Stack: Tauri 2 + Svelte 5 (runes) + TypeScript strict + Vite + Vitest. English UI. Dark compact UI, accent = theme yellow.
Read the code you touch first (zones: src/zones/**, brush: src/zones/brush*.ts + ZoneBrushLayer.svelte; R5 nodes: src/goal, src/progress, src/stats, src/scope; tasks: src/tasks/**).

USER DECISIONS 26.09 (binding):
- Menus (Q create menu, every RMB menu, zone menu, beacon menu, pickers/popovers opened on the board) are anchored to the BOARD point where they were opened and SCALE WITH THE BOARD like a node (camera pan/zoom keeps them on that spot, same world size).
- Any click anywhere outside an open popup menu closes it (zone RMB menu currently stays open).
- Zone tool: the brush grid is ALWAYS on (remove the Shift = off-grid feature from 1.1.5). Shift now TOGGLES between brush mode and zone-move mode (press = move mode on, press again = back to brush).
- Zones can be moved ONLY: (1) in the zone tool by pressing G while hovering a zone, (2) via RMB on a zone → "Move zone", (3) in the zone tool's Shift move mode. Moving works like moving a node (grab-follow, snap as nodes do); finish with Enter, RMB or switching to another tool/mode. Only the zone moves; holding Ctrl while moving carries the nodes inside along (M006 used Shift, now Ctrl). Collisions with other zones stay (stop at the obstacle). One Undo step per finished move; Esc cancels (restore).
- Goal: under "tasks x/y done" also show "subtasks x/y" = every task that feeds a directly connected task through strong links, the WHOLE chain upward (task0 → task1 → task2 → Goal: task1 and task0 are subtasks), each counted once, direct tasks excluded.
- Remove the task dependency rule "a task can't be completed while its predecessor is open" (R3/A05) completely — any task can be ticked.
- Progress/Statistics scope list gets a first option "Auto (under this node)" = the zone the node stands in, else Board — the current default, now selectable again.
- Progress/Statistics may link INTO a beacon with a strong line (normally nothing may enter a beacon). While such a link exists, that beacon is their scope and the scope list is locked (shows the beacon, disabled, tooltip "Linked to beacon — remove the link to change"). Removing the link unlocks and returns to the previous scope choice.

RULES:
- Several workers edit C:\hive\app concurrently. Edit ONLY files listed as yours (plus new files in your area and tests in app/tests/). Need anything else → `orca orchestration ask` the coordinator.
- No git commit/config. No new dependencies.
- Use your browser port with `npx vite --port <port> --strictPort`, stop it afterwards. Visual checks via headless Edge + CDP with a temp --user-data-dir; fixtures by importing app modules; real mouse via Input.dispatchMouseEvent — see C:\hive\docs\handoff\zbsmoke.mjs and r5smoke.mjs. Delete temp files you create.
- No fake features/dead buttons; every command mouse-reachable and in F3. Crisp rendering (no will-change/translate3d on board layers).
- Production quality, existing style. Pure logic in .ts with Vitest tests in app/tests/.
- Verify `npm run check` and `npm test` (if an error is clearly in another worker's in-progress file, say so).
- worker_done body in Russian: what you built, how to try it by hand, what's left out, decisions to confirm. Send worker_done ONCE.
