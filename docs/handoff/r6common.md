PROJECT: hive — spatial board for notes (Windows desktop). Repo root C:\hive (git), app in C:\hive\app (Tauri 2 + Svelte 5 runes + TS strict + Vite + Vitest; Rust backend in app/src-tauri/src: project.rs, watcher.rs). Installer 1.2.0. Now R6: trash, archive, restore, backups, export. You may be a fresh session: read C:\hive\docs\handoff\STATUS.md first.
Read first: C:\hive\ROADMAP.md section R6 (table R6.1–R6.5 + notes), C:\hive\NODES.md ND13, C:\hive\QUESTIONS_AND_IDEAS.md N068, I23, I24, C:\hive\FOLLOWUP_QUESTIONS.md H34, H46, and the code you touch.

USER DECISIONS (binding):
- Deleting notes, beacons and zones (Delete/Backspace, menus, commands) no longer destroys them: they go to the TRASH as one trash entry per delete action, together with the links of the deleted notes. Deleting a single link alone does not use the trash (Undo covers it). Cut (Ctrl+X) is a clipboard operation, not a trash delete.
- Trash is available BOTH as a panel (top-right button "Trash" next to Tasks/Objects, and in F3) AND as a "Trash" node on the board (Q menu). Both show the same project-wide trash: list of entries (what, when), per entry "Restore" and "Delete permanently", plus "Empty trash" (asks first). Before restoring, show which links will come back and which stay broken because their other end no longer exists (I23). Restored objects return to their old positions with text/formatting; missing link ends never create phantom links.
- Archive (N068/H34): RMB on a note → "Archive" (multi-selection archives each). Archived notes disappear from the board. An "Archive" node (Q menu) lists the project archive: per item "Restore to old place", "Restore to screen centre", "Duplicate near Archive" (independent copy placed next to that Archive node, no old links, original stays archived), "Delete permanently". Restore brings back surviving links only. Archived tasks' reminders stop (H46; no timers exist yet — just keep a note in code).
- Backups (R6.4): snapshot the whole project on project open, every 30 minutes if something changed, and manually ("Create snapshot"). Old snapshots are never deleted automatically (ROADMAP forbids auto-cleanup) — the user deletes them; show their size. Restoring a snapshot first snapshots the current state. A damaged current save must never overwrite a good backup. Integrity check (I24): report missing note files, dangling links, unknown kinds; no silent deletion.
- Export (R6.5): export the project as a .zip file (one Rust crate for zip is allowed: `zip`); import a .zip into a chosen folder and open it. Settings: backup interval (off/15/30/60 min), show space used by trash/snapshots/history.
- Restore from trash, Undo and archive are different operations. Every user action = one Undo step where it makes sense (move to trash / restore / archive / unarchive are undoable; "Delete permanently", "Empty trash", snapshot restore are not undoable and ask for confirmation).

CONTRACTS (committed by the coordinator, commit "R6 contracts"):
- src/model/retention.svelte.ts: TrashEntry {id, deletedAt, notes, zones, links}, ArchiveEntry {id, archivedAt, note, links}, stores `trash.entries`, `archive.entries`, replaceTrash, replaceArchive.
- NoteKind adds "archive" | "trash" (R6_KINDS), Q-menu entries exist, widths 40 u in R5_BASE_WIDTHS; register bodies via src/notes/nodeBodies.ts.
- board.json: add `trash` and `archive` arrays (optional, older boards → []); ProjectIndex allows extra keys. Worker A owns the trash lines in src/project/index.ts + persistence.svelte.ts, worker C owns the archive lines — both edit those files: re-read before each edit, touch only your lines.
- Existing: history execute/record, selection API, command registry (F3, effective keys), note menu registry (src/notes/noteMenu.ts), board-anchored popups (src/ui/boardAnchor.ts), settings (src/settings/**).

RULES:
- Several workers edit C:\hive\app concurrently. Edit ONLY files listed as yours (plus new files in your area and tests). Need anything else → `orca orchestration ask` the coordinator.
- No git commit/config. No new dependencies except the one allowed zip crate (worker E).
- Headless Edge is BLOCKED for workers — verify with code + Vitest (+ cargo test for Rust); the coordinator does real-mouse browser checks after worker_done. Give exact steps and data-attributes in worker_done.
- No fake features/dead buttons; every command mouse-reachable and in F3. Crisp rendering.
- Production quality, existing style. Pure logic in .ts with tests in app/tests/.
- Verify `npm run check`, `npm test` (and `cargo test` if you touched Rust).
- worker_done body in Russian: what you built, how to try it by hand, what's left out, decisions to confirm. Send worker_done ONCE.
