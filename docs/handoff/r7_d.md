TASK D — R7.4 Source node

Read C:\hive\docs\handoff\r7common.md first.
Your files: new src/source/** (SourceNodeBody.svelte, logic, actions, init), Rust command for checking a local file exists / opening with the default program if not already available through tauri-plugin-opener (app/src-tauri — only your new command + registration), tests.

Design it (N001 delegated to us): the node shows
1. A title (note name), an editable description (multi-line, plain text), a URL field and/or a file field ("Choose file…" via the dialog plugin; stores the absolute path; show the file name + folder).
2. "Open" buttons: URL in the default browser, file in its default program (tauri-plugin-opener). Validate URLs (http/https only, show an error otherwise).
3. Availability: file missing → "File not found" marker (checked on render/focus, cheap, cached); URL can't be checked offline → no marker unless opening fails.
4. Dropping a URL text or a file from the OS onto the board is out of scope (say so).
5. Every edit one Undo step (merge typing bursts like the note editor). Keyboard focus inside the node must not trigger board hotkeys.
Tests for URL validation and state logic.
