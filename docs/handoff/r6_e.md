TASK E — R6.5 Export/import .zip, storage settings

Read C:\hive\docs\handoff\r6common.md first.
Your files: app/src-tauri/ (Cargo.toml: add the `zip` crate only; new export.rs module + commands; minimal registration edits), new src/export/** (frontend), src/settings/** + src/ui/SettingsPanel.svelte (storage section), tests (Vitest + cargo test). Worker D owns the backup interval setting key/scheduler — you render its control in the Settings storage section (ask D/coordinator for the setter name).

1. Export: F3 "Export project…" and a Settings button → native save dialog (tauri-plugin-dialog, already present) → writes <name>.zip containing board.json, notes/, and other project data folders except .hive/backups (ask: include trash/archive data — yes, they are in board.json). Flush pending saves before exporting. Progress/success message with the file path; errors shown clearly.
2. Import: F3 "Import project from .zip…" → pick zip → pick an empty destination folder → extract (reject zip-slip paths, validate board.json parses) → open that project.
3. Settings "Storage" section: space used by trash (count + approx size), snapshots (count + size), history (Undo entries in memory, count), project folder size; backup interval control (off/15/30/60); buttons "Empty trash…" (calls worker A's emptyTrash with confirm) and "Open backups" (worker D's panel). Clear messages; nothing auto-deletes.
4. Tests: cargo test for zip round trip and zip-slip rejection; TS for size formatting.
