Debug 23 after 1.4.8 (03.10). The items come from the user's "debug 20.md".

Common rules are as in C:\hive\docs\handoff\d8common.md:
- headless Edge is blocked for workers; the coordinator tests with a real mouse;
- runes only in .svelte/.svelte.ts;
- send worker_done in Russian, once, and check that the send returned ok;
- `npm run check` + `npm test` must be green.

Two tasks run in parallel in C:\hive:
- Stay in your own files.
- Make shared-file changes as small isolated hunks, name them in your report, and commit them immediately.
- Run `git diff --cached --stat` before every commit, and commit ONLY your files.
- Never rewrite history. No attribution.

TASK PDFJS — item 1: crisp PDF at every zoom. Files: src/formats/** (PDF), package.json/package-lock.json (the new dependency), vite config only if a worker setting needs it, tests.
1. The built-in WebView2 PDF viewer inside an iframe is rasterised. Under the board's CSS scale, text gets blurry and slightly clipped, and embedded images get soft. The user wants PDFs to stay as sharp as the rest of the board at any zoom.
   - The coordinator APPROVES adding `pdfjs-dist` (the current stable version; check its docs through Context7 if unsure about the API and worker setup in Vite).
   - Replace the iframe with our own renderer:
     - Load the attachment with pdfjs `getDocument` (asset URL, or bytes fetched through the attachment URL; CSP connect-src already allows asset:).
     - Render the pages stacked vertically in a scrollable container inside the node body. The layout is in node-local CSS px: page width = node content width × pdfZoom (or fit width). Layout NEVER depends on the board zoom.
     - Each page is a <canvas> whose BACKING resolution = CSS size × devicePixelRatio × camera.zoom × noteScale, clamped to a sane maximum (e.g. 8192 px on the longest side, or a total-pixel budget per node). Re-render only the visible pages after zoom settles (~150 ms debounce). During the gesture, keep the old bitmaps scaled by CSS, so nothing jumps.
     - Images inside the PDF are rendered by pdf.js into the same canvas, so they get the same sharpness.
     - Text layer: not required now; skip it.
   - Keep the existing toolbar: −, the zoom label, + and Fit width. pdfZoom semantics and Undo stay the same; pdfZoom only changes the layout width, and the board zoom only changes the bitmap resolution.
   - Vertical scrolling uses the thin app scrollbar. Wheel over the PDF scrolls the pages; at either end it falls back to the board zoom, the same way as text notes and Format.
   - Performance: render lazily (IntersectionObserver within the node scroller), cancel stale render tasks, and destroy the document on unmount.
   - Remove the iframe path, the R=2 oversampling and the #zoom URL code. Delete the scroll-restore hack.
   - The CSP worker: pdf.js needs a worker. Use Vite's `?url` import of the pdfjs worker and set `GlobalWorkerOptions.workerSrc`. Confirm the CSP allows it ('self' covers bundled files). If you need `worker-src 'self' blob:`, ask the coordinator — CSP is coordinator-owned.
   Tests:
   - the backing-resolution math for zoom/scale/dpr, with clamping;
   - the layout width that is independent of the board zoom;
   - pdfZoom/fit label;
   - mock pdfjs for the render-scheduling logic.

TASK FMTWIDTH — item 2: Format node width limit. Files: src/formats/** (Format text node), src/formats/formatCreation.ts, tests.
2. Dropping a large .txt without line breaks creates a Format node that becomes extremely wide or long. The text runs off and can't be read.
   - Width: a Format node is created at the SAME default/maximum width rule as md text notes (look at how textDrop/createMarkdownNotes and the note width limits work, and reuse them). Its width never grows with content. The user can resize it horizontally within the usual limits.
   - Wrapping:
     - plain-text kinds (txt, log, md-like, csv, ini, and any language "plain") use CodeMirror `EditorView.lineWrapping`, so long lines wrap inside the width;
     - code kinds (json, py, js, ts, css, html, …) keep horizontal scroll inside the fixed width.
     - Expose this as a pure function `formatWrapsLines(language)` and test it.
   - Height: the initial height is capped like md notes. Longer content scrolls vertically, with the scrollbar from 65321fc.
   - Existing projects: Format nodes saved with an absurd width keep their saved width — don't rewrite user data — but their content wraps or scrolls correctly.
Tests: the creation width equals the md-note rule for a huge single-line txt, the wrap rule per language, and that the height is capped.

Reports: one worker_done per task, covering what changed, the shared hunks, and how to check by hand.
