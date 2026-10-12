# d43 a2 — bulk import and creation

## Changes

- Replaced per-note board scans for creation placement with `queryRect`-backed obstacle queries. Bulk imports use one grid placement pass; pasted groups shift together and keep their internal spacing. Name allocation builds one case-insensitive index and allocates suffixes without rescanning the growing list.
- Added bounded asynchronous preparation for image, audio, video, PDF, text, Markdown, and clipboard paste batches. Large clipboard payload validation and note cloning yield between slices; batches add/remove notes through one board splice and one mutation notification, with one Undo command per import or paste.
- Added native folder expansion and bounded path-import commands. Rust streams and hashes attachment files on the blocking pool, emits per-file progress, supports cancellation, and removes partial files on cancellation. Text reads use bounded batches. The shared import progress overlay reports counts/current file and supports Cancel; completed files are retained when an import is cancelled.
- Used the existing `addNotes`/`removeNotes` board batch helpers; those helpers were already present in the shared tree, so `board.svelte.ts` did not need an edit.

## Measurements

Synthetic Vite-node harnesses under `%LOCALAPPDATA%\Temp\claude\d43_a2\` used a board with 20,000 existing notes and 5,000 imported image refs:

- Synchronous creation: 50.53 ms total; yielding creation: 48.33 ms total in the same run. The yielding path's largest observed 1 ms event-loop tick gap was 8.18 ms, including scheduler overhead. Placement alone measured 2.37 ms with the spatial index already built.
- A 5,000-node clipboard payload (1,262,297 serialized bytes) validated in 11.53 ms asynchronously versus 13.31 ms synchronously; the largest observed async event-loop tick gap was 5.67 ms.
- These harnesses measure frontend parsing, placement, and node creation, not native disk-copy throughput. Native streaming, folder expansion, and cancellation are covered by Rust tests; real-drive I/O timing remains unmeasured.

## Validation

- `npm run check` — 0 errors and 0 warnings.
- `npm test` — 225 test files, 1,476 tests passed.
- `CARGO_TARGET_DIR=target-b cargo fmt --all -- --check` — passed.
- `CARGO_TARGET_DIR=target-b cargo test` — 108 tests passed.

## Files

- `app/src/App.svelte`
- `app/src/attachments/service.ts`
- `app/src/audio/audioActions.ts`
- `app/src/clipboard/commands.ts`
- `app/src/clipboard/payload.ts`
- `app/src/formats/boardFileDrop.ts`
- `app/src/formats/formatActions.ts`
- `app/src/formats/formatCreation.ts`
- `app/src/formats/textDrop.ts`
- `app/src/images/imageActions.ts`
- `app/src/notes/creationPosition.ts`
- `app/src/notes/noteCommands.ts`
- `app/src/ui/ImportProgress.svelte`
- `app/src-tauri/src/attachments.rs`
- `app/src-tauri/src/lib.rs`
- `app/src-tauri/src/text_import.rs`
- `app/tests/bulkCreation.test.ts`
- `app/tests/clipboard.test.ts`
- `app/tests/formats.logic.test.ts`
- `app/tests/images.test.ts`

No implementation work remains for a2. The only unmeasured item is native import throughput against a real large directory.
