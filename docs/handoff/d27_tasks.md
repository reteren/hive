Debug 21 after 1.4.6 (03.10). The items follow the user's "debug 18.md". The user's video and screenshots are not on disk; they are described here.
Common rules: as in C:\hive\docs\handoff\d8common.md.
- Headless Edge is blocked for workers; the coordinator tests with a real mouse.
- Runes only in .svelte/.svelte.ts.
- worker_done is sent in Russian, once; check that the send returned ok.
- `npm run check` and `npm test` must be green.
Four tasks run in parallel in C:\hive.
- Stay in your own files.
- Shared files: small, isolated hunks, named in the report. Re-read the file right before you edit it, and commit shared hunks immediately.
- Before every commit run `git diff --cached --stat`, and commit ONLY your own files. Never rewrite history.
- No attribution. Ask when unsure.

Coordinator (already doing these, don't touch):
- CSP: connect-src gains `asset: http://asset.localhost`. In the desktop build, `fetch()` of attachment URLs was blocked by CSP, while the browser dev build has no CSP. This is the likely cause of the empty Format nodes (item 3) and possibly of items 5 and 6.
- App icon (item 7).

TASK PDF3 — item 1. Files: src/formats/** (PDF), tests.
1. The user recorded it on video. They only roll the mouse wheel over EMPTY board space, far away from the PDF, and the PDF's internal view visibly re-zooms. That is our own doing: since 07e1563 the viewer gets `#zoom = pdfZoom × boardZoom × noteScale` and is re-laid-out after every zoom gesture.
   Required: the board zoom must NEVER touch the iframe. The PDF behaves like a static picture inside the node.
   - Lay the iframe out at a FIXED size: node width/height in CSS px × a constant oversampling factor R = 2. Pass the viewer only `#zoom=<pdfZoom>` (or page-width for Fit width). Counter-scale by 1/R inside the node.
   - The board transform then scales it like any node. It stays crisp up to about 2× board zoom, and above that is a little soft — accepted.
   - No zoom listener, no debounce re-layout, and nothing in the PDF depends on camera.zoom.
   - Only the node's −/+ /Fit width and resizing the node change the layout.
   - Remove the scroll-restore hack if it is no longer needed.
   Tests: the size math doesn't depend on board zoom (assert that the iframe props are identical for zoom 0.3, 1 and 3).

TASK TEXTNOTE — items 2 and 3. Files: src/notes/** text-body sizing/scroll hunks, src/editor/** if needed, src/formats/** (Format load path), tests.
2. Text notes (ordinary notes, including ones created from dropped .md):
   - When the note's manual height is smaller than its text, the body scrolls VERTICALLY, but only if the text has more than 15 lines. With 15 lines or fewer, keep today's behaviour: auto-height / the resize limit.
   - Never horizontal scrolling. Long lines wrap; the node width doesn't stretch to the text.
   - Vertical resize stays allowed. Horizontal resize must not change the line layout semantics: lines wrap at the node width, as they do today. Check that the md drop doesn't create unwrappable long lines (code blocks, tables). For those, wrap too, or clip with ellipsis — say which.
   - The scrollbar uses the app's thin styled scrollbar, if one exists (grep scrollbar styles); otherwise make a minimal dark one.
   - Mouse-wheel over a scrollable note body scrolls the text, not the board. When the body is at its top or bottom end, the wheel goes back to zooming the board.
3. JSON/TXT/PY dropped into the desktop build shows an empty error box. The coordinator fixes CSP connect-src, which should be the root cause: the FormatNodeBody `fetch(source)` of the asset URL was blocked.
   - Make the error state informative anyway: show the actual error message (e.g. "Could not load file: <reason>") instead of an empty box.
   - Add a fallback: if `fetch` of the asset URL fails, read the text through the Rust command `read_dropped_text` (it exists since 67dc9a6) using the absolute attachment path (attachment_directory + file).
Tests: the scroll rule (15 lines threshold), the no-horizontal-scroll CSS, the Format fallback path.

TASK TIER9 — items 5 and 6. Files: src/tierlist/**, tests.
5. The Tierlist audio card's play button does nothing in the desktop build.
   - Debug it: is the audio element created with the asset URL? Is play() rejected (catch and log it)? Is there a pointer handler on the card that swallows the click? Card drag starting on pointerdown is a likely culprit; the button must stop propagation.
   - Fix it so that play/pause works, and a failed play shows a small error state on the card.
6. Video cards in a Tierlist show NO preview in the desktop build, while YouTube cards do.
   - The middle-frame capture must work with asset URLs: video element with preload="auto", muted, playsInline, crossOrigin unset; wait for loadedmetadata, seek to duration/2 (when the duration is Infinity or NaN, use 1 s); on 'seeked' draw to a canvas and keep the canvas itself — don't call toDataURL, which taints. Add a timeout fallback that shows the first frame (currentTime 0.1).
   - If CSP was the cause (fetch of a blob), the coordinator's CSP fix covers that. Make the code robust either way.
Tests: card click routing (button vs drag), the frame-time computation, the timeout fallback.

TASK ALPHA — item 4. Files: src/images/**, src/editor/inlineImages.ts (style only), src/tierlist image card style hunks, tests.
4. Images and GIFs with an alpha channel must look transparent in hive:
   - board image nodes: no opaque background behind the picture (remove #1c1c1c body background and the card fill for kind "image"), and no visible frame fill — the selection outline still shows when selected;
   - inline images in text: no background;
   - Tierlist image cards: the picture over the card's normal background, with no extra fill;
   - the GIF still frame (canvas) keeps alpha: clear the canvas, don't fill it.
   - The "File missing" box keeps its own background.
Tests: the class/style for transparent image nodes, if testable.

Reports: one worker_done per task, covering what changed, the shared hunks, and how to check by hand.
