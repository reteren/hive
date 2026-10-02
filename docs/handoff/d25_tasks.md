Debug 19 after 1.4.4 (02.10). The items are the user's numbers from "debug 16.md" (the screenshots are not on disk; they are described here).

Common rules are in C:\hive\docs\handoff\d8common.md:
- headless Edge is blocked for workers; the coordinator tests with a real mouse;
- runes only in .svelte/.svelte.ts;
- send worker_done in Russian, once, and check that the send returned ok;
- `npm run check` + `npm test` must be green.

Four tasks run in parallel in C:\hive:
- Stay in your own files.
- In shared files, make small isolated hunks, name them in your report, re-read the file right before you edit it, and commit shared hunks immediately — never leave the shared index staged.
- Commit only your own hunks. No attribution.
- Ask when unsure.

The coordinator does item 12 personally (src/overview/**: Alt labels a YouTube node by its video title).

Coordinator defaults (the user didn't answer, so these were chosen):
- 9: on media nodes (video, YouTube, audio, dictaphone, PDF), the chrome text is not selectable — names, times, buttons, labels, the "Recording" state. Use user-select: none; prevent dragstart on images/thumbnails. Editable captions and text bodies stay selectable while being edited.
- 4: the frame comes back through the same RMB menu item, labelled "Show node frame".

Colour rule (11, 14): media controls are WHITE/neutral, not the gold accent:
- tracks: rgba(255,255,255,.25);
- filled part: #fff (or #e8e8e8);
- thumb: #fff;
- icons: #e8e8e8, hover #fff.
Keep the accent only for selection/focus outlines.

TASK YT — YouTube node: items 2, 3, 4, 5, 8, and item 11 for its controls. Files: src/youtube/**, tests; small hunks in the node RMB menu registration (registerNoteMenuItem), plus model/serializers only for the new flags.
2. A right-click ANYWHERE on a YouTube node opens the hive node menu (Copy link, Archive, Scale/Grab/Delete, …). Today, right-clicking the centre (over the iframe) opens YouTube's own context menu. Cover the iframe with a transparent capture layer while the video is not actively being interacted with. That layer forwards a left click to play/pause through postMessage and handles contextmenu → hive menu. The hive controls overlay stays on top.
3. RMB menu item "Loop video" / "Stop looping" (a toggle). Persist `youtube.loop?: true`. On end (state 0 via infoDelivery), seekTo(start or 0) and play; or use the embed params loop=1&playlist=<id>, if that is reliable.
4. RMB menu item "Hide node frame" / "Show node frame":
   - hidden: the node renders only the video player — no header, border, padding, or background;
   - it is still selectable and draggable by the player area (see 5) and resizable by the handles;
   - persist it as `Note.frameHidden?: true`, valid for youtube nodes now. Add it to note.ts + the 4 serializers as small hunks.
5. Holding LMB anywhere on the YouTube node and dragging moves the node, the same as the header:
   - the capture layer from 2 starts a node drag when the pointer moves beyond the drag threshold;
   - a plain click without movement toggles play;
   - double-click does nothing special.
8. Space toggles play/pause while the pointer is over a YouTube node, exactly like video. Use src/media-ui/hoverPlayback.ts (registerHoverPlayback) with a postMessage play/pause.
11. The YouTube overlay controls follow the white colour rule.
Tests: menu routing over the capture layer, the loop state, frameHidden serialization, the drag threshold vs click, and Space.

TASK VID — video node and shared media-ui: items 7, 9, 10, and item 11 for video/audio. Files: src/video/**, src/media-ui/**, src/audio/AudioPlayerRow.svelte (colours only, coordinate with AUD), tests.
7. The video volume slider is VERTICAL: a small popover above the volume icon with a vertical MediaSlider (orientation="vertical" is in the contract — implement it in MediaSlider if it is still missing).
10. The volume popover must not disappear while the pointer travels from the icon to the slider:
   - hover-intent: keep it open while the pointer is over the icon OR the popover, with a ~250 ms grace period on leave;
   - no gap between the icon and the popover (use padding as a bridge);
   - clicking the icon toggles mute;
   - keyboard focus keeps it open.
11. Timeline, buttons and the volume follow the white colour rule in MediaSlider/MediaIcon/MediaTime and the video controls. The audio player rows (AudioPlayerRow) get the same colours — change only their colour tokens and leave the rest to AUD.
9. Apply the no-select default to the video and audio player chrome and to the media-ui components.
Tests: vertical slider keyboard/drag math, the hover-intent timer, colour tokens, if they are testable as constants.

TASK AUD — dictaphone: items 6 and 14. Files: src/audio/** (except the colour tokens of AudioPlayerRow, which VID owns), tests.
6. Dragging a recording row out of the dictaphone onto EMPTY board space must work. It doesn't today.
   - Reproduce it with real pointer events in a test that simulates pointerdown on a row → pointermove outside the node → pointerup over the board.
   - The result is a new standalone audio node with that file at the drop point, and the recording leaves the dictaphone list — "вынуть" means move, not copy. One Undo step restores both.
   - Holding Ctrl while dropping copies instead of moving.
   - Show a drag ghost (the row's name) while dragging.
14. The live level visualizer and the "Recording" label are WHITE (the visualizer bars are white at ~85% opacity; the label is #fff). The record button stays red.
9. Apply the no-select default to the dictaphone chrome.
Tests: the drag-out state machine (threshold, drop inside the node = reorder or nothing, drop outside = new node + removal), and the undo.

TASK PDFHDR — items 1 and 13. Files: src/formats/** (PDF), the header/drag hunk in src/notes/NoteNode.svelte (or wherever header drag lives), tests.
1. The PDF content scale must NOT follow the board zoom. Today, zooming the board changes the scale inside the PDF.
   - The document's internal zoom changes only with + / − buttons in the PDF node: 50%–300%, step 10%; a "Fit width" button; the zoom value persisted as `media`-independent `Note.pdfZoom?: number`, with small serializer hunks.
   - Keep the crispness from 1e04f7e: render at device resolution, but compensate so the visual size of the content stays constant in the node's own coordinates — the node scales with the board like any node, while the PDF's internal zoom stays fixed.
   - Verify that the iframe's internal zoom parameter (#zoom=) or the counter-scale gives a stable layout.
13. Hidden header: when a node's header is hidden (headerHidden), the header AREA still exists invisibly — pressing LMB in that top strip and dragging moves the node, as if the header were shown. This applies to all node kinds that support Hide header.
   - The strip height is the normal header height.
   - It must not steal clicks from content that actually sits there, unless that content is just padding — so the strip sits above the body only where the header would be.
Tests: the pdfZoom clamp/persist, zoom independence math, and the hidden-header drag hit-area.

Reports: one worker_done per task, covering what changed, the shared hunks, and how to check by hand.
