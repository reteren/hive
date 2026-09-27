TASK D — debug 8: Source node p.9, p.13, p.14, p.14.1, p.15

Read C:\hive\docs\handoff\d8common.md and debug 8.md first.
Your files: src/source/**, app/src-tauri/src/source.rs + capabilities (opener scopes only), OS file/URL drop handling for Source (Tauri drag-drop event: `getCurrentWebview().onDragDropEvent` — find where the board listens or add a listener in src/source/), tests. Size rule for Source (fixed size, no resize) → send to worker E via the coordinator.

1. p.15: opening files from Source does not work at all — find the root cause (opener capability scope for open-path? path format? missing permission for the file's location?) and fix it. Verify with cargo/unit tests and describe the manual steps.
2. p.14/14.1 redesign: one field "URL/File" with placeholder "https://… or C:\Users\Example\file.mp4"; accepts a URL or a local path; the button is just "Open" (opens URLs in the browser, files — images, video, documents, .exe and any other file — with the default Windows program / launches executables; folders open in Explorer). Remove the separate "File" label under the field. Choosing a file ("Choose file…") or dropping one puts its path into the field and shows it on the line under URL/File (as the user wrote). Remove the footer text "add links and files with these fields, drag and drop is not supported".
3. p.9: drag & drop onto a Source node works: dropping a file from Explorer sets its path; dropping a URL/text sets the URL. Use the Tauri drag-drop events (HTML5 DnD does not work in this webview). Only when dropped over a Source node; drops elsewhere are ignored.
4. p.13: Source is not resizable (tell E: kind "source" → fixed size like Trash/Archive; pick a sensible size, report it).
5. Security: opening .exe runs arbitrary programs — only on an explicit click on Open; show the full path in the tooltip.
Tests: URL/path classification, field parsing, drop handling logic.
