TASK R — review of the storage work (task A, d31_a.md). Read C:\hive\docs\handoff\d31common.md and d31_a.md first. Do NOT change behaviour without asking; report findings, then fix only confirmed bugs in the files below after the coordinator says yes.

Files: app/src-tauri/src/attachment_migration.rs (new), attachments.rs, export.rs, backup.rs, project.rs (migration hook), src/attachments/*, src/source/*, src/video/VideoNodeBody.svelte, src/formats/*, src/model/nodeData.ts.

The user's real project has ~1.1 GB of hash-named attachments, 125 notes, trash + archive entries, inline images in notes/*.md, and .hive/backups snapshots. Data loss is the one unacceptable outcome. Check concretely:
1. Migration: every reference kind is found and rewritten (image.file, media.file, recordings[].file, format/pdf files, tier items, trash[] / archive[] entries, clipboard, inline image tokens in notes/*.md, any other ".file" field — grep the TS model for every attachment-name field and compare with collect_legacy_references). A missed kind = dangling reference after old files are deleted.
2. Crash safety: kill at every step (journal written, partial copies, board.json rewritten, md partly rewritten, old files partly removed) → next open completes correctly. Old files are only deleted after ALL rewrites succeeded. A read-only/locked file (e.g. a video open in another player) must not abort into a broken state.
3. Backups: restoring a snapshot taken BEFORE migration (hash names) after migration (readable names) still restores media.
4. Same bytes referenced by two nodes with different names; two different files wanting the same readable name; Windows reserved names, unicode, very long names, case-only collisions.
5. Performance: first open of a 1.1 GB project — copy vs rename? (install_copy copies; consider fs::rename/hard link inside the same folder — say what's safe.)
6. External video >20 MB: asset scope allows only that file; missing file placeholder; zip excludes it; trash/undo of the node.
7. Dropped arbitrary files (.zip/.exe/.docx) end in attachments/ and open from there.
Run cargo test (CARGO_TARGET_DIR=C:/hive/app/src-tauri/target-alt) and npm test. Send worker_done with a numbered findings list (severity, file:line, repro) — Russian.
