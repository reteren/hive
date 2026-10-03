Debug 22 after 1.4.7 (03.10). Items follow the user's "debug 19.md".

Common rules are as in C:\hive\docs\handoff\d8common.md:
- headless Edge is blocked for workers; the coordinator tests with a real mouse;
- runes only in .svelte/.svelte.ts;
- worker_done is sent once, in Russian, and you check that the send returned ok;
- `npm run check` + `npm test` must be green.

Three tasks run in parallel in C:\hive:
- Stay in your own files.
- Shared files get only small isolated hunks, named in the report. Re-read the file right before you edit it and commit shared hunks immediately.
- Before every commit, run `git diff --cached --stat` and commit ONLY your files.
- Never rewrite history. No attribution. Ask when unsure.

The coordinator does item 4 (installer/exe icon) personally.

TASK OPAC — item 1: image/GIF opacity. Files: src/images/**, the image RMB menu hunk (noteMenu image allow-list), model/serializers hunks for the new field, tests.
1. The RMB menu on an image or a GIF node gets an item "Opacity…". It opens a small popover anchored at the menu point with a horizontal slider from 10% to 100% (step 5) and the value shown.
   - Use the shared MediaSlider (src/media-ui) and the white/neutral media tokens.
   - While dragging, the picture's opacity updates live. On release the change is one Undo step.
   - Escape or a click outside closes the popover.
   - Persist `Note.opacity?: number` (0.1–1; absent = 1) through the project, archive, trash and clipboard.
   - The selection outline and handles stay fully opaque; only the picture fades.
   - The Alt overview box is unaffected.
   - Add the item to the image allow-list next to Copy link/Archive.
Tests: clamp, persistence, undo, menu presence for both image and GIF.

TASK PDF4 — item 2. Files: src/formats/** (PDF), the PDF resize-rule hunk in src/selection/resize.ts, tests.
2. After 2635baa/068ba2c the PDF no longer follows the board zoom (keep that!), but now:
   a) − / + do nothing visible;
   b) "Fit width" does nothing;
   c) the node cannot be resized VERTICALLY.
   Fix all three:
   - − / + must change the PDF's internal content zoom: 50–300%, step 10%. The fixed-layout iframe (node size × R) must re-render with the new #zoom. Changing only the hash of an iframe src does NOT reload the built-in viewer, so force a reload: re-key the iframe, or set src to about:blank and then to the new URL, keeping a cache-busting fragment counter. Verify it actually re-renders.
   - "Fit width" sets the page-width mode and re-renders the same way.
   - The displayed level ("100%" / "Fit") must match what is actually rendered.
   - Vertical resize of the PDF node is allowed — free height, min 30 u. Check why it is blocked; probably the size rule treats pdf as fixed-aspect or height:null. Horizontal resize also stays.
   - Each zoom change is one Undo step, as before.
   - Nothing may depend on camera.zoom.
Tests: an iframe key/URL change on zoom/fit, the vertical resize allowed, and the level label.

TASK FMTSCROLL — item 3. Files: src/formats/** (Format text node), tests. Reuse the scroll approach from 5159cce/e57604b (text notes) where possible.
3. Format nodes (txt, json, py, css, …): when the node is resized smaller than its content, the editor scrolls with a visible thin styled vertical scrollbar, the same look as text notes. Rules:
   - The wheel over the editor scrolls the text; at the top or bottom end it falls back to zooming the board, as with text notes.
   - Long lines in code: horizontal scroll IS acceptable here for code (no wrapping by default), but use the same thin scrollbar style. If the user prefers wrapping later, it is a one-line switch — keep it as a constant.
   - The node can be resized vertically freely (min ~10 u).
   - The CodeMirror scroller must be the element that scrolls. Today, likely an outer container with overflow hidden clips it — fix the height chain (node body → editor → .cm-scroller with height 100%).
Tests: the height chain/overflow CSS and the wheel routing.

Reports: one worker_done per task, covering what changed, the shared hunks, and how to check by hand.
