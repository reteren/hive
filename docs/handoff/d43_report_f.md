# D43-F implementation report — Heavy content per node

## What changed

- Added a shared decoded-image cache that resizes to the shown size (capped at 2× display pixels), limits retained decodes by pixel and entry budgets, and releases evicted `ImageBitmap`s. Attachment transparency checks now inspect and cache a 64 px thumbnail per attachment URL. GIF stills use downscaled copies; child images, GIF animation, video frames, and YouTube thumbnails wait until they are near the viewport. GIF animation still follows the existing playback mode and stop state.
- Board video and audio elements use `preload="none"`; Tierlist audio is created on explicit play. Video and YouTube capture gestures now share one set of window pointer listeners that exists only while a gesture is active. Active board video/audio, YouTube, and Tierlist audio playback pins the host note.
- YouTube oEmbed requests share a bounded promise cache keyed by video ID and start only near the viewport. Tierlist video stills use a 32-entry / 6 MP LRU cache and clear evicted canvases.
- PDF documents load only while their note is in `visible.ids`. The page viewport mounts a window of page placeholders (two view heights before and three after the current scroll position). Format nodes use an 8 KiB streamed text preview without CodeMirror until selected or dirty. Markdown previews switch back to plain text when they leave their viewport, use the shared visible set, and reuse linked-note discovery for cached parse trees.
- Long List rows and Tierlist card contents use `content-visibility: auto` with intrinsic size hints; dynamic rows and cards stay in the DOM so existing drag/reorder geometry remains available. Mark gradients stop animating at simple/min LOD, and glow is reduced to a 1 px shadow outside full LOD.

## Files changed

`app/src/attachments/AttachmentImage.svelte`, `app/src/attachments/GifView.svelte`, `app/src/attachments/displayBitmap.ts`, `app/src/attachments/imageTransparency.ts`, `app/src/audio/AudioNodeBody.svelte`, `app/src/audio/AudioPlayerRow.svelte`, `app/src/editor/MarkdownPreview.svelte`, `app/src/editor/markdown.ts`, `app/src/formats/FormatNodeBody.svelte`, `app/src/formats/PdfNodeBody.svelte`, `app/src/formats/formatLoad.ts`, `app/src/list/ListBody.svelte`, `app/src/modules/modules.css`, `app/src/notes/noteGlowLogic.ts`, `app/src/tierlist/TierlistBody.svelte`, `app/src/tierlist/TierlistVideoFrame.svelte`, `app/src/tierlist/audioPlayback.svelte.ts`, `app/src/tierlist/videoPreview.ts`, `app/src/video/VideoNodeBody.svelte`, `app/src/video/mediaCaptureGesture.ts`, `app/src/youtube/DeferredYouTubeThumbnail.svelte`, `app/src/youtube/YoutubeNodeBody.svelte`, `app/src/youtube/logic.ts`.

Added `app/tests/attachments.displayBitmap.test.ts`, `app/tests/attachments.imageTransparency.test.ts`, and `app/tests/tierlist.videoPreview.test.ts`; extended `app/tests/formatLoad.test.ts` and `app/tests/youtube.logic.test.ts`.

## Verification

- Focused tests for image sizing/cache eviction, alpha probing, Format preview streaming, YouTube metadata deduplication, and Tierlist frame eviction passed (23 tests). The existing image-alpha and Tierlist audio playback tests also passed after the final adjustments, for 28 focused tests passing.
- Final full `npm test` run: 215 test files passed and 4 failed; 1,449 tests passed and 5 failed. The remaining failures are in zone membership/ME lookup tests and a rune-placement check for `src/drawing/coarseCompositeCache.ts`, outside this task's files.
- Final `npm run check` passed with 0 errors and 0 warnings.
- No before/after application benchmark was run; the repo instructions prohibit opening a real project, and the shared workspace still has cross-area test failures.

## Remaining follow-up

- Rerun the full suite after the concurrent zone membership and drawing rune-placement failures are reconciled.
- PDF page DOM is virtualized, while PDF.js page-size metadata and page proxies are still acquired for all pages once the document becomes visible.
- List/Tierlist item DOM is not unmounted because existing drag/reorder code reads live item geometry; browser content visibility and child-media deferral reduce offscreen work while keeping those bounds stable.
