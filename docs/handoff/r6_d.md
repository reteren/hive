TASK D — R6.4 Backups (snapshots) + integrity check

Read C:\hive\docs\handoff\r6common.md first.
Your files: app/src-tauri/src/ (new backup.rs module + commands registered in lib.rs/main.rs — minimal edits there; project.rs only if a shared helper is needed), new src/backup/** (frontend API, BackupsPanel.svelte, scheduler), the settings entry for the backup interval (coordinate with worker E who owns the settings UI — you own the backup settings key and scheduler), tests (Vitest + cargo test).

1. Snapshots stored in <project>/.hive/backups/<ISO timestamp>/ with board.json + notes/ (+ future attachments folder if present); written atomically (temp dir + rename). Never snapshot a project that fails to parse — keep the last good snapshot untouched (a damaged current save must not overwrite a good backup).
2. When: on project open, every N minutes (default 30; off/15/30/60 from settings) only if the project changed since the last snapshot, and manually ("Create snapshot" in the Backups panel and F3).
3. Backups panel (F3 "Backups", and a button in Settings): list snapshots (date, size, note count), "Restore" (confirm; first creates a snapshot of the current state, then replaces the project files and reloads the board), "Delete" (confirm). Total size shown. No automatic deletion.
4. Integrity check (I24, F3 "Check project health"): report missing .md files, notes without index entries, dangling links, unknown kinds, invalid zones — a report dialog, no silent fixes; offer "Create snapshot" before any fix the user chooses (fixes out of scope unless trivial and explicit).
5. Tests: Rust — snapshot/restore round trip, atomicity, refusing to snapshot corrupt board.json; TS — scheduler change detection.
