Debug 18 after 1.4.2 (01.10). Items follow the user's file "debug 15.md"; the screenshots were not saved to disk, so this spec describes them.
Common rules: as in C:\hive\docs\handoff\d8common.md.
- Headless Edge is blocked for workers; the coordinator tests with a real mouse.
- Runes only in .svelte/.svelte.ts.
- Send worker_done in Russian, once, and verify the send returned ok.
- `npm run check` + `npm test` must be green.
Three tasks run in parallel in C:\hive.
- Stay in your own files.
- In shared files, make small isolated hunks, name them in your report, and re-read the file right before you edit it.
- Commit only your own hunks; no attribution. Commit shared-file hunks promptly, so the shared index never stays blocked.
- Ask when unsure.
The coordinator does item 1 (the Importance node) personally.

Design language (all three tasks): the app's dark UI.
- Surfaces #282828–#2f2f2f; borders #3a3a3a–#4a4a4a; text #d8d8d8, muted #8a8a8a; accent var(--accent) (gold).
- Small radii (3–4 px); compact 11–12 px UI text; tabular numbers for times.
- Thin tracks (3–4 px) with a small round thumb that grows on hover; no native browser look anywhere.
- Respect `data-reduce-motion` on <html>.
SHARED UI (owned by AUDIO; VIDEO imports it):
- src/media-ui/MediaSlider.svelte: seek/volume slider. Pointer drag, keyboard arrows, the filled part in the accent colour, a buffered part in a lighter grey, and a hover time tooltip for seek.
- src/media-ui/MediaTime.svelte: formatted mm:ss / h:mm:ss.
- src/media-ui/icons: play, pause, volume, mute, record, stop, export, delete, fullscreen.
- AUDIO commits these FIRST, as their own commit, and notifies the coordinator.

TASK AUDIO — debug item 5 + redesign items 1 and 2. Files: src/audio/**, src/media-ui/**, tests. Model hunks in model/note.ts plus the serializers, but only for the new recordings field. Ask first if you need the field.
5. The recorder node becomes a dictaphone that holds a LIST of recordings.
   - A new "Record audio" node starts IDLE. Recording begins only when the user presses the big record button; the record/stop button never disappears.
   - Each stop appends one recording (an attachment via importRecording) to the list in the lower part of the node; the node grows downward to fit.
   - Each recording row has:
     - a play/pause button, the shared seek slider and its duration;
     - a name that is editable (double-click), defaulting to "Recording 1", "Recording 2", …;
     - an export button that saves it as a file (exportAttachmentAs);
     - a delete button.
   - Undo: each new recording, rename and delete is one Undo step.
   - Dragging a recording row out of the node and dropping it on the board creates a separate standalone audio node with that file, at the drop point (one Undo step).
   - Storage: keep each recording's file as stored; webm/opus is fine. MP3 encoding is not required — if exporting must be .mp3, ask.
   - The existing rules stay:
     - selecting another node doesn't stop recording;
     - window blur stops and saves, unless "Record in background" is on;
     - only one recording at a time.
   - Model: `Note.recordings?: { id: string; name: string; media: MediaRef }[]` on an audio node in dictaphone mode. Add it to note.ts and to all four serializers. A plain imported audio file stays a single-file audio node.
Redesign 1 (dictaphone): modelled on a phone voice-recorder screen.
- At the top, a large live waveform/level area while recording, and a big round red record button that turns into a square stop button.
- Elapsed time in large tabular digits.
- Background #282828, not black.
- The recordings list underneath uses the SAME player row as redesign 2.
Redesign 2 (audio file player): replace the current ugly native-looking controls with:
- a compact row: play/pause, the seek slider with the elapsed/total time, and a volume button that reveals a small vertical or horizontal slider on hover;
- the file name above it.
- Space toggles play/pause while the pointer is over the node (see the VIDEO item 3 rule).
Tests: dictaphone state machine with several recordings; rename/delete/undo; drag-out creating a node; serializer round-trip.

TASK VIDEO — debug items 2 and 3 + redesign item 3. Files: src/video/**, src/youtube/**, tests. Import from src/media-ui once AUDIO has committed it; until then, code against the names above.
3. Space key: while the pointer is over a video node (or an audio node — share one small helper with AUDIO; export it from src/media-ui/hoverPlayback.ts, and you own that file), Space toggles play/pause and must NOT trigger the board's Space action (teleport to beacon). Implement this as a keydown handler that runs before the board command (capture), only when no text editor is focused.
Redesign 3 (local video player): no native `controls`.
- A custom overlay at the bottom: play/pause, the shared seek slider with a hover-time tooltip, the time, volume, and fullscreen.
- Click on the video toggles play.
- The controls fade out 0.5 s after the pointer stops moving or leaves; they stay visible while paused.
- The style follows the design language above.
2. YouTube visual:
   - The embedded YouTube controls are too big, and they disappear too slowly.
   - Load the embed with `controls=0` and build compact hive controls over it using the same postMessage channel you already have: playVideo/pauseVideo/seekTo/setVolume/mute via {"event":"command","func":...}, and the time/duration from infoDelivery.
   - Use the same overlay as the local video player.
   - It hides 3× faster than YouTube's own, i.e. ~0.5–1 s after the pointer stops or leaves.
   - Keep "Open on YouTube" and the existing error handling.
   - If YouTube refuses `controls=0` for a video, fall back to the native controls.
Tests: the Space routing (pointer over a video → play/pause, not a beacon jump; editor focused → untouched), the controls auto-hide timer, and the postMessage command encoding.

TASK PDFQ — debug item 4: PDF quality. Files: src/formats/** (PDF part) and tests.
4. The embedded PDF is blurry, and the text is barely readable. Cause: the iframe is rendered at its layout size inside the board's CSS `scale(zoom)` transform, so the browser rasterises it once and then scales the bitmap.
   - Fix: render the frame at screen resolution. Size the iframe at (node width × zoom, node height × zoom) CSS px and counter-scale it with `transform: scale(1/zoom)` inside the node (transform-origin 0 0), so its content is laid out and painted at device pixels. Re-apply on zoom changes, debounced (~120 ms) to avoid re-layout thrash while zooming.
   - Also make sure there is no extra scale from the Note.scale / group scale; it uses the same correction.
   - Verify in the browser that text is crisp at zoom 0.5, 1 and 2 (the coordinator re-checks in the desktop build).
   - If the Format text editor shows the same blur at high zoom, apply the same idea only if it is cheap. Otherwise, report it.
Tests: the size/scale math for several zoom and scale combinations.

Reports: one worker_done per task, covering what changed, the shared hunks, and how to check by hand.
