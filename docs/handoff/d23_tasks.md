R9 delivery 2 = R9.3 (PDF + text Format), R9.4 (audio + microphone recording), R9.5 (local video), R9.6 (YouTube). Written 01.10 after 1.4.1.

Common rules — as in C:\hive\docs\handoff\d8common.md:
- headless Edge is blocked for workers; the coordinator tests with a real mouse;
- runes only in .svelte/.svelte.ts;
- don't bump Tauri JS packages;
- worker_done in Russian, sent once; check that the send returned ok;
- `npm run check` + `npm test` must be green; Rust also `cargo test` (CARGO_TARGET_DIR=C:/hive/app/src-tauri/target-alt).

Four tasks run in parallel in C:\hive:
- Stay in your own files.
- Shared files: only small isolated hunks, named in your report. Re-read a shared file right before you edit it.
- Commit only your own hunks; no attribution.
- Ask when unsure.

Contract (coordinator-owned, read first):
- src/attachments/types.ts: the bottom block — MediaKind, the MIME lists, TEXT_FORMAT_LANGUAGES, MEDIA_LIMIT_BYTES, MediaRef, YouTubeRef, plus the policy comment.
- src/model/note.ts: NoteKind + "pdf" | "format" | "audio" | "video" | "youtube"; `Note.media?: MediaRef`; `Note.youtube?: YouTubeRef`; base widths.
- The kind label/icon/colour maps are already filled in: trashListModel, overviewLogic, MapView, list/icons.

User defaults (stated to the user):
- Text files are edited as a copy in the project. Each save creates a new attachment file and repoints the node, as one Undo step. "Save as…" exports the text.
- Size limits: audio/video 2 GB; everything else 200 MB.
- All of R9.3–R9.6 ships in this wave.

Roadmap acceptance (ROADMAP.md R9):
- PY is shown and edited, but NEVER executed.
- Saving changed text and reopening it shows the change.
- PDF is view-only; this is not a promise of a PDF editor.
- Recording:
  - selecting another node does NOT stop a recording;
  - losing window focus stops the recording by default;
  - a setting allows background recording (H37). This rule applies to recording, not to playback.
- Local video is its own object with playback and a saved caption under it. It is not YouTube (H38).
- YouTube:
  - when a video forbids embedding, show the reason and an "Open on YouTube" action;
  - check it on the real desktop build.
- Every import error is explained, and no broken node is created.

Shared entry points (new in this wave; all owned by STORE2 except where noted):
- `importMediaPath(path: string): Promise<MediaImportResult>` and `importMediaFile(file: File): Promise<MediaImportResult>` in src/attachments/service.ts. They detect the kind (pdf/text/audio/video) by magic bytes, falling back to the extension for text. Result: `{ ok: true; media: MediaRef } | { ok: false; error: string }`.
- `importRecording(bytes: Uint8Array, mime: string, name: string): Promise<MediaImportResult>` for the recorder.
- `saveTextAttachment(text: string, previous: MediaRef): Promise<MediaImportResult>` writes the edited text as a new file with the same extension and name.
- `exportAttachmentAs(ref: AttachmentRef, suggestedName: string): Promise<boolean>` opens a save dialog and copies the file out.
- `mediaKindForPath(path)` / `mediaKindForFile(file)`: a quick check of the extension/type, so drop handlers can decide synchronously whether a drop is theirs.
- Browser fallback (vite dev): keep the bytes in memory and serve object URLs, as images do now. The coordinator's smoke tests rely on this.
- Drop/paste routing: each media task registers its own FileDropHandler at priority 5 that accepts only its kinds and creates its node at the drop point. Image drops keep priority 0. Paste: register with registerImagePasteHandler only if your kind can come from the clipboard (files); priority 5.

TASK STORE2 — backend and service for non-image files. Files:
- src-tauri/src/attachments.rs (hunks);
- src-tauri capabilities/conf if needed;
- src/attachments/service.ts (new exported functions; keep the image API intact);
- Rust and TS tests.
1. Rust:
   - Detect pdf (`%PDF-`), audio (mp3 ID3/frame sync, wav RIFF/WAVE, ogg OggS, flac fLaC, webm/matroska 1A45DFA3 — audio vs video by the caller's hint or extension, m4a/mp4 `ftyp`), video (mp4/mov `ftyp` brands → video/mp4, webm).
   - Text: accepted by the extensions in TEXT_FORMAT_LANGUAGES when the bytes are valid UTF-8 (BOM allowed).
   - Limits per kind from the contract.
   - `attachment_import_path` streams large files: hash while copying into a temp file, then rename. No full read into memory.
   - New command `attachment_write_text(text, extension, name)`.
   - New command `attachment_export(file, destination)`, with the destination from the dialog plugin.
   - Health check and backup pool already handle any file in attachments/; verify that with a PDF and a video.
2. Media seeking needs HTTP range support on the asset protocol. Verify that `<video>` can seek on an asset:// URL in the desktop build (Tauri's asset protocol supports Range). If it can't, say so — don't work around it silently.
3. CSP: add `media-src` and `frame-src` to tauri.conf.json:
   - `media-src 'self' blob: asset: http://asset.localhost`;
   - `frame-src https://www.youtube-nocookie.com https://www.youtube.com`, for TASK VIDEO;
   - also `img-src https://i.ytimg.com` for YouTube thumbnails.
4. Tests:
   - Rust: magic bytes per kind, the limit per kind, streaming hash = full hash, text that is not UTF-8 is rejected.
   - TS: the browser fallback for each kind.
Land the service API first, as its own commit, and notify the coordinator.

TASK FORMAT — R9.3: "pdf" and "format" nodes. Files:
- new src/formats/** (PdfNodeBody.svelte, FormatNodeBody.svelte, logic);
- small hunks in: NoteNode.svelte (render the bodies), noteCommands.ts (create), CreateMenu.svelte (Q menu: "PDF…", "File…" — each opens a picker), and the serializers project/archive/trash/clipboard (keep `media`; grep every kind list that has "image");
- tests: tests/formats.*.test.ts.
1. PDF node:
   - shows the document using the webview's built-in PDF viewer in an `<iframe>`/`<embed>` on the asset URL (WebView2 has one). If that is blocked by CSP or the sandbox, ask before you add pdf.js.
   - Minimum size 30×30 u, resizable.
   - The header shows the file name.
   - "Open externally" in the RMB menu (opener plugin), plus the universal Scale/Grab/Delete items (already automatic).
   - A missing file shows the error box.
2. Format node:
   - a CodeMirror editor with the syntax for the language when a CodeMirror language package already exists in node_modules; otherwise plain text. Don't add packages without asking.
   - Monospace font and line numbers.
   - Editing and saving:
     - edits are kept in the editor state;
     - "Save" (Ctrl+S while the editor is focused) calls saveTextAttachment and repoints `media` — ONE undoable model change;
     - an unsaved change shows a dot by the name;
     - closing/deselecting with unsaved changes keeps the draft in the session, with no data loss.
   - "Save as…" uses exportAttachmentAs.
   - A header line shows "Copy in project · <name>.<ext>" so it is always clear which file is saved (the roadmap rule).
   - PY/JS/SH/PS1 are NEVER executed; no run button.
3. Creation:
   - OS drop of pdf/text files onto the board (FileDropHandler priority 5) at the drop point;
   - the Q menu entries.
   - Errors go through reportImportError.
4. Tests: kind detection routing, the save → new ref + a single undo, the unsaved marker, serializer round-trips, and that no execution path exists.

TASK AUDIO — R9.4: the "audio" node + recording. Files:
- new src/audio/**;
- a setting row "Record in background" (default off; persisted with the view settings) — a small hunk in settings + SettingsPanel;
- small hunks in NoteNode.svelte, noteCommands.ts, CreateMenu.svelte (Q menu: "Audio file…", "Record audio"), and the serializers;
- tests.
1. Player: play/pause, a seek bar with current time and duration, a volume control; the node text under the player (like captions) is optional and stays editable as a normal text body. Use a plain `<audio>` element on the attachment URL.
2. Recording:
   - "Record audio" creates an audio node in the recording state: a big red record/stop button, elapsed time, and a level meter.
   - getUserMedia({audio:true}) + MediaRecorder (audio/webm;codecs=opus).
   - On stop: importRecording → the node becomes a normal audio node (one Undo step for the whole creation). Cancel removes the node.
   - Rules:
     - selecting other nodes, panning or zooming does NOT stop it;
     - window blur stops it and SAVES what was recorded, unless "Record in background" is on;
     - a clear state is shown: "Recording…", "Stopped — saved", "Microphone blocked", "No microphone".
   - Only one recording at a time. A denied permission gives a clear message and no broken node.
3. Import: OS drop of audio files (FileDropHandler priority 5) and "Audio file…" from the Q menu.
4. Tests: the state machine (idle → recording → saving → ready / error; blur with and without the background setting; selection change doesn't stop), serializer round-trips.

TASK VIDEO — R9.5 local video + R9.6 YouTube. Files:
- new src/video/** and src/youtube/**;
- small hunks in NoteNode.svelte, noteCommands.ts, CreateMenu.svelte (Q menu: "Video file…", "YouTube link…"), the serializers, and the board paste path;
- tests.
1. Local video (ND50):
   - an MP4/WebM drop creates a video node at the drop point, sized from naturalWidth/Height (longest side 48 u);
   - a `<video controls>` player;
   - a caption text under the video: the node `text`, editable as usual and saved.
   - Playback doesn't autoplay. Seeking works (report if the asset protocol prevents it).
2. YouTube:
   - Ctrl+V of a youtube.com / youtu.be / shorts URL on the board (when not editing text) creates a youtube node at the pointer (like image paste in d21). The "YouTube link…" Q entry asks for a URL in a small inline input.
   - Parse videoId and start (t=, start=). Invalid URL → explain it, no node.
   - The node shows the thumbnail `https://i.ytimg.com/vi/<id>/hqdefault.jpg` with the title.
   - The title/author come from `https://www.youtube.com/oembed?url=...&format=json` when online; a failure keeps just the id.
   - Clicking play swaps in an `<iframe src="https://www.youtube-nocookie.com/embed/<id>?start=..&autoplay=1">`.
   - "Open on YouTube" is in the RMB menu (opener plugin).
   - If the embed reports that it isn't allowed (YouTube error 101/150/153 via the IFrame API postMessage, or the iframe shows an error), show "This video can't be played inside hive (<reason>)" plus an "Open on YouTube" button.
   - Note: the Tauri webview origin may itself trigger error 153 — detect it and report it to the coordinator, who checks the real desktop build.
3. Tests: URL parsing (watch?v, youtu.be, shorts, embed, t=1m30s, invalid), the error-state mapping, video size fitting, and serializer round-trips.

Reports: one worker_done per task, covering what changed, the shared hunks, and how to check by hand.
