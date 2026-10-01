Debug 16 after 1.3.9 (written 01.10). The items are the user's numbers. Common rules are in C:\hive\docs\handoff\d8common.md:
- headless Edge is blocked for workers; the coordinator tests with a real mouse;
- runes only in .svelte/.svelte.ts;
- worker_done is written in Russian, sent once, and you check that the send returned ok;
- `npm run check` and `npm test` must be green.

Three tasks run in parallel in C:\hive:
- Stay in your own files.
- In shared files, make small isolated hunks, name them in your report, and re-read the file right before you edit it.
- Commit only your own hunks. No attribution.
- Ask when unsure.
- The coordinator does item 1 personally (src/overview/**). Don't touch it.

Coordinator defaults (the user didn't object):
- A GIF stopped with RMB stays stopped until "Play gif", whatever the setting says.
- In Tierlist, the "Add image…" tiles disappear; adding moves into the row's RMB menu.

TASK GIF: item 2, GIF playback everywhere (board image node, inline images in text, Tierlist cards, any other place that shows an attachment GIF).
Files:
- new src/attachments/gifPlayback.svelte.ts: playback state + setting;
- new src/attachments/GifView.svelte: a Svelte view that shows a still frame or an animated image;
- a plain-DOM helper for the CodeMirror widget, e.g. src/attachments/gifDom.ts;
- settings: preferences + SettingsPanel row;
- small hunks in src/images/ImageNodeBody.svelte (replace its own canvas/still logic with GifView), src/editor/inlineImages.ts (the widget), and the Tierlist image card component;
- the RMB menu entries (board node menu: registerNoteMenuItem in NotesLayer, as "notes.copyLink" does; Tierlist card menu; inline image: an RMB on the widget opens a small menu, or reuse the editor context menu if one exists — check src/spell/contextMenu.svelte.ts).
Tests: tests/gif.*.test.ts.

1. By default GIFs play nonstop. Setting "GIF playback" (persisted with the other view settings): Always (default) / On hover / When selected.
   - On hover: a GIF plays while the pointer is over it.
   - When selected: a board image plays while its node is selected. Inline and Tierlist GIFs play while their host node is selected, or while the pointer is over the GIF itself.
   - Otherwise the GIF shows its first frame: draw it to a canvas once.
2. RMB on any GIF shows ONE entry, "Stop gif" or "Play gif" depending on the current state. A stopped GIF shows its still frame and ignores the setting until "Play gif". Non-GIF images don't get the entry.
3. Where the stopped state lives:
   - The stopped flag persists in the model for board images (`Note.gifStopped?: true`; add it next to `image` in note.ts and in the serializers — a small hunk; project/archive/trash/clipboard keep it).
   - For Tierlist cards it persists on the card (`stopped?: true`; parseTiers hunk).
   - For inline GIFs it is session state keyed by note id + token position (not persisted; say so in the report).
   - Toggling is not an Undo step.
4. Performance: a board with many GIFs must not decode them all as canvases each frame. A still frame is drawn once; an animated GIF is a plain <img>.
5. Tests: the mode logic (always/hover/selected × stopped), and that the setting persists.

TASK IMGFIX: items 3, 4, 5, 6 for board image nodes (the "image" kind).
Files:
- src/images/** except what TASK GIF touches in ImageNodeBody (coordinate: GIF replaces the picture element, you own the rest of the node);
- the image hunks in NoteNode.svelte, selection/resize.ts, selection/SelectionLayer.svelte, selection/groupScale.ts, the scale tool, and clipboard paste position.
Tests: tests/images.*.test.ts.

3. Remove the header from image nodes entirely. It must not render at all, not just be hidden: no "show header" toggle in the menu, no header double-click target, no rename via the header. The name still exists in the model for search/lists/overview. Image nodes created before this change with headerHidden false also show no header.
4. Negative scale = mirror.
   - Dragging a resize handle of an image past the opposite edge flips the image on that axis and keeps resizing from there (the frame normalises to positive width/height).
   - Store the flip as `Note.flipX?: true` / `Note.flipY?: true`; serializers keep it (small hunks). The picture renders with transform: scaleX(-1) / scaleY(-1).
   - Ctrl (keep proportions) still works while flipping.
   - The S scale tool / group scale also flips an image when you drag through zero.
   - One Undo step per gesture.
5. The scale binding (S tool / group scale) has NO limits for images and GIFs: no maximum, and the minimum is only the 4×4 u floor (or a flip through zero, per item 4). Other node kinds keep their limits. Find where the limits come from (groupScale clampScale/maximumWidthForKind/minimumWidthScale, the S tool) and make images exempt.
6. Ctrl+V of an image places it where the mouse pointer is (pointer.world — clipboard/commands already reads it for hive pastes), centred on the pointer, not at the viewport centre. If the pointer is outside the board, fall back to the viewport centre. Same for the paste-event path in src/images/imageActions.ts handleBoardImagePaste, and for the board fallback paste handler registerImagePasteToBoard (coordinator code from d3e378e; you may change it). Several images cascade from the pointer.
Tests: flip by resize (both axes, with Ctrl), unbounded S scaling for images vs bounded for notes, paste at the pointer.

TASK TIER7: item 7 + the Tierlist part of the defaults. Files: src/tierlist/** and tierlist tests.
7. Remove the dashed "Add image…" tiles from Tierlist rows completely (screenshot: every row showed one). Adding images stays available through:
   - drag-and-drop onto a row;
   - Ctrl+V over a row;
   - a new "Add image…" entry in the row's RMB menu (wherever the row/label RMB menu is; if a row has none, add a minimal one on the row label with this entry), which opens pickImageFiles.
   Keep row heights and the empty-row look as they were before R9.
Tests: no tile is rendered; the menu entry calls the picker; adding is still one Undo step.

Reports: one worker_done per task, listing what changed, the shared hunks, and how to check it by hand.
