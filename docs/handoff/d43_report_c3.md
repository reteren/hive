# d43 c3 — 20k project open performance

## Changes

- Added opt-in Rust stage timing (`HIVE_PROFILE_OPEN=1`) for project open, board collection reads and sorting, attachment migration, Markdown loading, cache setup, external-media scope, and the seeded note watcher. The watcher continues to use the fingerprints gathered while reading note text; it does not reread Markdown.
- Attachment migration now checks for a regular legacy hash-named attachment before loading the board or scanning Markdown. If no such source file exists and there is no recovery journal, it returns immediately; journal recovery and projects that do have legacy files keep the existing path.
- Project open derives allowed external-video paths from its already-loaded board and passes those paths to the asset-scope refresh. This removes another full board read while keeping the scope limited to valid referenced video paths.
- Automatic open snapshots now use the changed-only path. The Rust command is async and runs fingerprinting and snapshot I/O in `spawn_blocking`, so the board can render before the background snapshot finishes. New snapshot metadata records the live-project fingerprint separately from the archive fingerprint; old metadata remains readable and causes a safe fresh snapshot the next time it is checked. Project open invalidates the fingerprint cache so edits made while a project was inactive are detected.

## Synthetic benchmark

Generated a disposable split project under `%LOCALAPPDATA%\Temp\claude\d43_c3_task_ee72fb5b45f1\project-20k`: 20,000 nodes (19,000 short-text notes and 1,000 image nodes), 3,000 links, 20,000 short Markdown files, and 1,000 small image files. The direct Rust harness timed `open_project_root`; it did not create a Tauri window or time the frontend.

| Stage | Before | After |
| --- | ---: | ---: |
| Attachment migration on a project with no legacy hash files | 2,609.9 ms | 1.0 ms |
| Migration's redundant board read | 1,558 ms | skipped |
| Migration's Markdown reference scan | 1,012 ms | skipped |
| Main board load (`read_document`) | 1,398.5 ms | 1,481.5 ms |
| Read and fingerprint note bodies | 1,596.0 ms | 2,163.0 ms |
| `open_project_root` total | 6,027 ms | 4,121 ms |

The run-to-run note-read variation reflects filesystem cache and disk scheduling; the required note bodies are still read once. The total fell by about 1.9 seconds (32%) and the measured root-open path is below the 5-second target. The post-change collection read/parse times were 1,209 ms for 20,000 nodes and 163 ms for 3,000 links; sorting those collections took 4.8 ms and 0.6 ms. Cache setup plus external-video extraction was 168 ms, and index JSON serialization was 154 ms.

An unconditional snapshot of the same synthetic project took 25.5 seconds. It now runs only when the live source fingerprint differs from the latest snapshot and runs on the blocking worker pool after project state is applied. The full Tauri `open_project` command and watcher setup were not run in a desktop window; the new environment-gated logs cover those stages for a runtime profile.

## Validation

- `CARGO_TARGET_DIR=target-b cargo test`: 111 passed.
- `npm run check`: 0 errors and 0 warnings.
- `npm test`: 226 files and 1,480 tests passed.
- `cargo fmt --all -- --check` passed.

## Files changed

- `app/src-tauri/src/project.rs`
- `app/src-tauri/src/board_store.rs`
- `app/src-tauri/src/attachment_migration.rs`
- `app/src-tauri/src/attachments.rs` (coordinator-approved scope reuse)
- `app/src-tauri/src/watcher.rs`
- `app/src-tauri/src/backup.rs`
- `app/src/backup/scheduler.svelte.ts`
