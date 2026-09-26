PROJECT: hive — spatial board for notes (Windows desktop). Repo root C:\hive (git), app in C:\hive\app. R0–R5 done, installer 1.1.7. This wave = the user's debug list for 1.1.7. You may be a fresh session: read C:\hive\docs\handoff\STATUS.md first.
Stack: Tauri 2 + Svelte 5 (runes) + TypeScript strict + Vite + Vitest. English UI. Dark compact UI, accent = theme yellow.

RULES:
- Several workers edit C:\hive\app concurrently. Edit ONLY files listed as yours (plus new files in your area and tests in app/tests/). Need anything else → `orca orchestration ask` the coordinator.
- No git commit/config. No new dependencies.
- Headless Edge is BLOCKED for workers by policy — don't try to start it. Verify with code + Vitest; the coordinator runs real-mouse browser checks after your worker_done. In worker_done give exact manual test steps and data-attributes to target.
- No fake features/dead buttons; every command mouse-reachable and in F3. Crisp rendering (no will-change/translate3d on board layers).
- Production quality, existing style. Pure logic in .ts with Vitest tests in app/tests/.
- Verify `npm run check` and `npm test` (if an error is clearly in another worker's in-progress file, say so).
- worker_done body in Russian: what you built, how to try it by hand, what's left out, decisions to confirm. Send worker_done ONCE.
