PROJECT: hive — spatial board for notes (Windows desktop). Repo root C:\hive (git), app in C:\hive\app (Tauri 2 + Svelte 5 runes + TS strict + Vite + Vitest; Rust in app/src-tauri/src). Installer 1.2.3 (R0–R7 done). This wave = the user's "debug 8" list: C:\hive\old debug message (do not touch)\debug 8.md (read it — the original Russian wording is binding; don't edit that file). You may be a fresh session: read C:\hive\docs\handoff\STATUS.md first.

USER DECISIONS (27.09, binding):
- Random placement (p.3): gap between EDGES of 10–35 u (random per axis), random side; if that spot collides, add another 10–35 u gap from the conflicting node; never overlap.
- Statistics ↔ List (p.6): for text rows show words/characters of the row text; zones/missing targets show "—"; notes show words/characters/lines; beacons show number of connections.
- Mark as (improvement 1): one Mark-as node holds SEVERAL user tags (text ≤30 chars + colour); one "frame" checkbox per Mark as: frame coloured with the tag colours, several tags → animated gradient cycling through them (like Importance absolute, respecting reduce-motion). Insert into a note and pull out like Mood/Purpose.
- Random Choice node (p.8): leave as is (may be removed later).
- Svelte runes ($state/$derived/$effect) ONLY in .svelte / .svelte.ts files (tests/runesPlacement.test.ts enforces it — a rune in plain .ts makes the app blank).
- Tauri JS packages must stay on the Rust crates' minor versions (@tauri-apps/api ~2.11, plugin-global-shortcut ~2.3) — never bump them.

CONTRACTS (coordinator commits d9a14c3, 7ce78c0): NoteKind "markas" (R7_KINDS, Q menu, base width 14 u); Note.customMarks?: CustomMark[] {id, text, color}, Note.customMarkFrame?: boolean, Note.listStats?: boolean — persisted in board.json, trash and archive (src/model/nodeData.ts parseCustomMarks, CUSTOM_MARK_MAX_LENGTH = 30).

RULES:
- Several workers edit C:\hive\app concurrently. Edit ONLY files listed as yours (plus new files in your area and tests). Resize/size rules live in src/selection/resize.ts (worker E owns it this wave — others send E the rule they need via the coordinator). Shared seams (src/main.ts, NoteNode.svelte, SelectionLayer.svelte, links rules, capabilities, lib.rs) — only minimal diffs you were allowed, re-read before each edit.
- No new dependencies unless listed in your task.
- Headless Edge is BLOCKED for workers — verify with code + Vitest (+ cargo test); the coordinator does real-mouse checks. Give exact steps + data-attributes in worker_done.
- Production quality, existing style, one Undo step per user action, English UI, crisp rendering, no dead buttons, commands in F3.
- Verify `npm run check`, `npm test` (and `cargo test` if you touched Rust).
- worker_done body in Russian, once.
