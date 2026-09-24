PROJECT: hive — spatial board for notes (Windows desktop). Repo root C:\hive (git), app in C:\hive\app. R0–R2 are done and accepted (installer 1.0.5). Now phase R3: Task, Importance, Purpose, plus/minus mini-nodes.
Stack: Tauri 2 + Svelte 5 (runes) + TypeScript strict + Vite + Vitest. UI language: English. Dark compact Blender-inspired UI (the real visual design pass comes later — keep things clean and consistent, not final art).
Read first: C:\hive\ROADMAP.md section "R3" incl. "Решения пользователя 23.09 перед R3" (binding decisions), "Технические границы" (esp. §8 crisp rendering: never add will-change/translate3d to board layers), C:\hive\NODES.md rows ND02–ND06 and "Режимы…", C:\hive\FOLLOWUP_QUESTIONS.md H09–H16, and the code you touch. "note" = text node.

CONTRACTS (committed; ask the coordinator before changing their shape):
- src/model/note.ts: Note.type: NoteKind ("note"|"pro"|"con"); task?: TaskState|null ({done, doneAt}); importance?: ImportanceLevel|null (basic/medium/important/immediately/absolute = white/yellow/red/purple/rainbow); purposes?: PurposeKind[] (quote, concept, openQuestion, decision, hypothesis, experiment, compare, timeline). Absent fields = defaults (not a task, no importance, no purposes).
- src/tasks/taskLog.svelte.ts: taskLog.entries — completion history (separate from Undo).
- src/tasks/dependencies.ts: canCompleteTask(noteId) → {ok, blockers} (stub; implemented by the dependencies worker).
- src/notes/noteMenu.ts: registerNoteMenuItem({id,label(noteId),run(noteId),visible?,order?}) + noteMenuItems(noteId) — the note right-click menu is built from this registry.
- NoteNode renders <TaskCheckbox {note}/> (src/tasks/TaskCheckbox.svelte) at the start of the header and <NoteModules {note}/> (src/modules/NoteModules.svelte) between header and frame; the root has data-kind, data-task ("open"|"done"), data-importance attributes for styling. Per-feature global stylesheets already imported by main.ts: src/tasks/tasks.css, src/modules/modules.css, src/notes/noteKinds.css.
- Existing: board store + raw mutations (src/model/board.svelte.ts), links (src/model/links.svelte.ts, Link {from,to,kind strong|weak,shape,anchors}), history execute/record (one Undo stack — every user-facing change is ONE HistoryCommand), selection API, command registry (registerCommand; effective keys may be user-overridden; never hardcode key text in UI; Tab bindings forbidden; auto-repeat ignored unless repeat:true), src/navigation/navigate.ts teleports, project persistence src/project/** (board.json + notes/*.md).
- Occupied keys: Space, Home, =/-, Ctrl+0, Shift+G, Alt+S, [ ], N, Q, G, T, C, V, 1, F2, F3, Ctrl+Shift+K, Ctrl+Z/Y/Shift+Z, Ctrl+Alt+Z, Ctrl+C/X/V, Delete/Backspace, Shift+D, Ctrl+O, Ctrl+Shift+N, Alt+O, Alt+←/→, WASD, editor Ctrl+B/I/E/1, Ctrl+Shift+H. Ctrl+D reserved (drawing).

RULES:
- Several workers edit C:\hive\app concurrently. Edit ONLY files listed as yours; need anything else → `orca orchestration ask` the coordinator.
- No git commit/config. Dependencies only if allowed.
- Dev app may run on 1430; use your browser port with `npx vite --port <port> --strictPort`, stop it afterwards. For visual checks you may drive headless Edge via CDP ("C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe" --headless=new --remote-debugging-port=<9300+port-offset> …) and add fixtures by importing app modules in the page (e.g. `await import('/src/model/board.svelte.ts')`) — no committed fixtures.
- No fake features/dead buttons; every command mouse-reachable and in F3.
- Production quality, existing style. Pure logic in .ts with Vitest tests in app/tests/.
- Verify `npm run check` and `npm test` (if an error is clearly in another worker's in-progress file, say so).
- worker_done body in Russian: what you built, how to try it by hand, what's left out, decisions to confirm. Send worker_done ONCE; a printed JSON response means delivered — don't resend.
