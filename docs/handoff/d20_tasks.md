R9 delivery 1 = R9.1 (attachment storage) + R9.2 (images and GIFs). Written 30.09 after 1.3.8. Rules as in C:\hive\docs\handoff\d8common.md:
- headless Edge is blocked for workers; the coordinator tests with a real mouse;
- runes only in .svelte/.svelte.ts;
- don't bump Tauri JS packages;
- worker_done in Russian, sent once — check that the send returned ok;
- `npm run check` and `npm test` green; for Rust also `cargo test` (CARGO_TARGET_DIR=C:/hive/app/src-tauri/target-alt).

Four tasks run in parallel in the same tree (C:\hive):
- Stay in your own files.
- Keep shared-file changes to small isolated hunks, and name them in your report.
- Re-read a shared file right before you edit it; never reformat it.
- Commit only your own files and hunks (`git add -p` is fine). No attribution lines.
- Ask when unsure.

Contract (coordinator-owned, commit 6b35a7d) — read it first:
- src/attachments/types.ts: AttachmentRef / ImageRef, the storage and backup policy, IMAGE_MIME_TYPES, and the inline token `![alt](att:<file>){w=NN}` (INLINE_IMAGE_PATTERN, default 50%).
- src/model/note.ts: NoteKind + "image", R9_KINDS, `Note.image?: ImageRef`, base width image: 30.
- src/model/nodeData.ts: TierCard + `{ kind: "image"; image: ImageRef }`. The coordinator put compile shims in tierlist/logic.ts tierCardPreview and list/transfers.svelte.ts; TIER replaces the first one.

User decisions (30.09):
- Delivery 1 = storage + images/GIF.
- Attachments go into backups ONCE, with no duplicates: a shared pool, and each snapshot lists its files.
- An inline image in text starts at 50% of the text width, and the user can resize it freely.

Roadmap acceptance (ROADMAP.md R9.1/R9.2):
- Copying or exporting the project keeps its attachments.
- A failed import never creates a broken node without an explanation; say what went wrong.
- Photos sit below the other nodes.
- Ctrl keeps the proportions while resizing.
- An embedded GIF plays when selected.
- Copies are independent.
- The list of supported formats is the verified one (png, jpeg, gif, webp, bmp), not "all formats".

Service API — STORE implements it in src/attachments/service.ts; everyone else imports exactly these names. STORE lands this file FIRST, as its own commit, and notifies the coordinator.
```ts
export type ImportResult = { ok: true; image: ImageRef } | { ok: false; error: string };
export function importImageFile(file: File): Promise<ImportResult>;      // clipboard / browser File
export function importImagePath(path: string): Promise<ImportResult>;    // OS drag-drop path, file dialog
export function pickImageFiles(): Promise<string[]>;                     // tauri-plugin-dialog, image filters; [] on cancel
export function attachmentUrl(file: string): string;                     // for <img src>; "" if unknown
export function reportImportError(error: string): void;                  // the one user-visible error surface
export type FileDropHandler = (paths: string[], target: Element | null, client: { x: number; y: number }) => boolean;
export function registerFileDropHandler(priority: number, handler: FileDropHandler): () => void; // higher priority first; true = handled
export function clipboardImageFiles(event: ClipboardEvent): File[];      // image files in a paste event
```
- In the browser (vite dev, no Tauri), importImageFile keeps the bytes in memory, and attachmentUrl returns an object URL for them. The coordinator's smoke tests depend on this. importImagePath / pickImageFiles return an error / [] there.
- The natural size is read on import: createImageBitmap, or an Image element, from the same bytes.

TASK STORE — storage, backend and service. Files:
- new src-tauri/src/attachments.rs, plus small hunks in lib.rs (invoke handler, setup), project.rs (the scope refresh on project open/create), backup.rs and export.rs if needed;
- Cargo.toml: `sha2`, and the tauri feature `protocol-asset`;
- tauri.conf.json: assetProtocol, and CSP `img-src 'self' data: blob: asset: http://asset.localhost`, and the same for `media-src` (for later R9 steps);
- new src/attachments/service.ts, src/attachments/AttachmentImage.svelte, src/attachments/dropDispatch.ts;
- tests: Rust unit tests and tests/attachments.*.test.ts.

1. Rust commands:
   - `attachment_import_bytes(bytes, name?, mime?)` and `attachment_import_path(path)`:
     - detect the type from magic bytes (png/jpeg/gif/webp/bmp; anything else → the error "Unsupported file type: <ext>. Supported: PNG, JPEG, GIF, WebP, BMP");
     - apply a 200 MB limit with a clear error;
     - hash with sha256 and name the file `<hash>.<ext>` in `<project>/attachments/`;
     - write through temp + rename; an existing identical file is reused;
     - return {file, mime, size, name}.
   - `attachment_directory()` returns the absolute attachments path. There is no project in dev mode, so return an error there.
   - Never follow symlinks out of the folder; validate the file-name pattern on every command.
2. Asset protocol:
   - enable it with an empty static scope;
   - on every project open/create/switch, allow `<root>/attachments` (recursive = false) through `app.asset_protocol_scope()`, and forbid the previous project's folder.
   - Check with Context7 or the Tauri docs if unsure. Don't bump Tauri versions.
3. Backups with deduplication:
   - a pool `<snapshots folder>/attachments-pool/<file>`;
   - each snapshot writes `attachments.json` (the list of files) instead of copying the folder;
   - restore copies from the pool;
   - deleting a snapshot removes pool files that no remaining manifest uses;
   - old snapshots that contain an `attachments/` folder must still restore.
   - Measure storage stats with the pool counted once.
4. Health check: report attachment files that are referenced but missing. References are:
   - `"file"` values of the `image` objects in board.json, including tier cards;
   - `att:` tokens in note texts.
   Show them as "Missing attachment <file>".
5. Frontend:
   - service.ts as above;
   - AttachmentImage.svelte: `<img>` with a loading and an error state. On error it shows a neutral box: "File missing: <name or file>". The consumers pass class/style;
   - dropDispatch.ts: the single Tauri `onDragDropEvent` listener for files. It calls the registered handlers in priority order and passes `document.elementFromPoint`.
   - The existing Source drop listener (src/source/init.ts) must keep working: either register it as a handler (preferred; small hunk) or leave it alone and make sure the image handlers ignore drops onto Source nodes.
   - reportImportError uses the app's existing notice/toast mechanism, if there is one (grep); otherwise add a minimal one.
6. Tests:
   - Rust: magic-byte detection; dedup; a bad name is rejected; pool GC; restoring an old snapshot.
   - TS: the browser fallback round-trip; drop-handler priority.

TASK IMG — images on the board (the "image" node). Files: new src/images/**, plus small hunks in:
- NotesLayer.svelte (render order);
- NoteNode.svelte (body + chrome for the image kind);
- noteCommands.ts (create);
- CreateMenu.svelte (Q menu "Image…" → pickImageFiles);
- selection/resize.ts (the image rule);
- project/index.ts, archive/serialization.ts, trash/serialization.ts, clipboard/payload.ts (the kind + parsing `image`; grep every kind list that has "calendar");
- links/rules if linking needs it.
Tests: tests/images.*.test.ts.

1. Creation:
   - OS drag-drop onto the empty board creates one image node per file at the drop point (cascade them). Register a FileDropHandler with priority 0 (the lowest — the fallback).
   - Ctrl+V with an image in the clipboard, while no text editor is focused, creates one at the viewport centre. Hook into the existing board paste path; check how clipboard/commands handles paste. An image in the clipboard wins over hive's own clipboard only when the system clipboard holds an image file.
   - Q menu "Image…" opens the file picker, then places the chosen files at the viewport centre.
   - All of this is one Undo step per import action.
   - Errors go through reportImportError, and no node is created.
2. Size: the node gets the image aspect ratio, with the longest side 40 u (small images at their natural size ÷ PX_PER_UNIT, at least 6 u). The height is always set (not null).
3. Layer: image nodes render BELOW every other node — first in DOM order, keeping their relative order — also while selected or dragged. Lines and zones behave as for other nodes.
4. Resize:
   - free by default; with Ctrl held, the aspect ratio stays fixed (roadmap). Show a small hint "Ctrl — keep proportions" while resizing, like the other hints.
   - Minimum size 4×4 u.
   - Vertical scale behaves as for other nodes.
5. GIF: when the node is not selected, show a still first frame (draw it to a canvas once); when selected, show the animated `<img>`. Other formats are just an img with `object-fit: contain` or `fill`, matching the node box.
6. Chrome:
   - The header is hidden by default; the name is the file name without the extension, or "Image"; the name is editable like the other kinds.
   - No text body.
   - The selection outline and handles are as usual.
   - Archive/Trash/restore/copy/paste/duplicate keep `image` (the file is shared and immutable, so copies are independent).
   - A missing file shows the AttachmentImage error box inside the node.
7. Tests: size fitting; render order; Ctrl resize ratio; serializer round-trips (project/archive/trash/clipboard); an import error creates no node and leaves no undo entry.

TASK INLINE — images inside note text. Files:
- editor/markdownSyntax.ts (inline token);
- editor/MarkdownPreview.svelte (rendering);
- editor/createNoteEditor.ts, or a new editor/inlineImages.ts (CodeMirror widget + paste/drop);
- new src/images/inline/** if useful — but IMG owns src/images/ root files, so use src/editor/ or src/images/inline/ only.
Tests: tests/inlineImages.*.test.ts.

1. Token `![alt](att:<file>){w=NN}`. Parse it as its own element; `{w=NN}` is optional (default 50); clamp NN to 5..100.
2. Preview (not editing): the image as a block at NN% of the text width, aspect preserved, centred-left like the paragraphs. A missing file shows the AttachmentImage error box.
3. Editing (CodeMirror):
   - While the cursor is outside the token, replace it with a widget that shows the image at the same size; while the cursor is inside, show the raw token.
   - The widget has a drag handle on its right edge; dragging changes NN (live preview) and commits ONE text change on release (one Undo step).
   - Clicking the image selects/places the cursor next to the token.
4. Insert:
   - Ctrl+V of an image while editing a note: import it, then insert the token on its own line at the cursor.
   - OS drag-drop onto a note that is being edited: register a FileDropHandler with priority 20 when the target is inside the active editor; insert at the drop position, or at the cursor.
   - Errors go through reportImportError.
5. Text features keep working: copy/paste of text carries the token (the image comes along because the file is shared); search doesn't match inside the file hash; spellcheck skips the token; the text-fit width logic isn't broken by images.
6. Tests: the parser (with/without w, clamping, not matching inside code spans), the resize → a single text change, paste insertion.

TASK TIER — image cards in Tierlist. Files: src/tierlist/** and tierlist tests; parseTiers in model/nodeData.ts (a small hunk); the coordinator's shim in tierlist/logic.ts tierCardPreview (replace it).
1. Adding an image card to a row:
   - OS drag-drop onto a Tierlist row: register a FileDropHandler with priority 30 that resolves the row under the pointer;
   - Ctrl+V while a row/card of this Tierlist is hovered or focused (follow how text cards are added);
   - an "Add image…" entry wherever "add text card" lives, using pickImageFiles.
   - One Undo step per action.
2. The card shows the picture at the card height, aspect preserved (width follows); cards can be dragged between rows and reordered like the others. A missing file shows the error box.
3. The existing moves to List etc. keep working (the coordinator's shim labels an image card by its name).
4. Serializing: parseTiers accepts the image card (validate ImageRef fields), and project/archive/trash/clipboard round-trips keep it.
5. Tests: parse/validate, add/move/undo, preview.

Reports: after each task, send one worker_done with what changed, the shared-file hunks you touched, and how to check it by hand.
