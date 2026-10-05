PROJECT: hive — spatial board for notes (Windows desktop). Repo root C:\hive (git), app in C:\hive\app (Tauri 2 + Svelte 5 runes + TS strict + Vite + Vitest). Installer 1.6.5. This wave = the user's "debug 26": C:\hive\old debug message (do not touch)\debug 26 huge changes.md (read it — the Russian wording is binding; never edit that file). Read the top paragraph of C:\hive\docs\handoff\STATUS.md first.

GOAL OF THE WAVE: hive becomes an Obsidian-like replacement — a project is one self-contained folder (board.json + notes/*.md + attachments/ + drawing/) that can be zipped or pushed to git and opened on a friend's PC. Plus a File / Edit menu bar and several small fixes.

USER DECISIONS (asked 05.10, binding):
- 20 MB rule applies ONLY to video: a video file > 20 MB is NOT copied into the project, the node references it by absolute path; on another PC (file missing) the node shows its name, no playback, no preview. Everything else (images, GIF, PDF, audio, text, json, md, any other dropped file) is copied into the project folder at any size (existing size limits stay).
- Files inside the project get READABLE names (attachments/photo.png, attachments/photo (2).png), not hashes. Old projects are migrated on open.
- Module/tech nodes keep their data in board.json (notes/*.md stays as today). Do NOT move module data into .md.
- An MCP server for hive is planned LATER — do not build it, but don't make choices that block it.

RULES:
- Six workers edit C:\hive\app concurrently. Edit ONLY files listed as yours (plus new files in your area and tests). Need a change elsewhere → ask the coordinator (orca orchestration ask) with the exact diff. Shared files: small isolated hunks, re-read right before editing, list them in worker_done.
- Svelte runes only in .svelte / .svelte.ts. Never put a plain object you later compare by identity into $state (it becomes a proxy).
- No new npm dependencies, no new Rust crates unless asked. Don't bump @tauri-apps packages.
- Headless Edge is BLOCKED for workers — verify with code + Vitest/cargo test; the coordinator does real-mouse checks. Give exact manual steps + data-attributes in worker_done.
- Production quality, existing style, English UI, one Undo step per user action, respect html[data-reduce-motion="true"]. Never lose user data: any file move/rename is crash-safe (write new → update index atomically → remove old), and idempotent if interrupted.
- Do NOT commit. Verify `npm run check` and `npm test` in C:\hive\app; Rust: `cargo test` with CARGO_TARGET_DIR=C:/hive/app/src-tauri/target-alt. worker_done body in Russian, once; check the send returned ok.
