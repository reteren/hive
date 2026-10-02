Debug 20 after 1.4.5 (02.10). The items are the user's numbers from "debug 17.md" (screenshots not on disk).

Common rules are in C:\hive\docs\handoff\d8common.md:
- headless Edge is blocked for workers; the coordinator tests with a real mouse;
- runes only in .svelte/.svelte.ts;
- worker_done in Russian, sent once, and check that the send returned ok;
- `npm run check` + `npm test` must be green.

Five tasks run in parallel in C:\hive:
- Stay in your own files.
- Shared files: small isolated hunks, named in your report. Re-read the file right before editing, and commit shared hunks immediately; never leave the shared index staged.
- Commit only your own hunks. No attribution.
- Ask when unsure.

The coordinator does item 7 personally: node header names are not selectable.

TASK PDF2 — item 1. Files: src/formats/** (PDF part), tests.
1. The user zooms the BOARD with the wheel and the PDF content must NOT change its size relative to the node. Today, with a fixed pdfZoom (e.g. 100%), the iframe is laid out at node×boardZoom CSS px and counter-scaled. The page is then rendered at a constant SCREEN size, so when the user zooms out, the node shrinks but the text stays the same size on screen (it "scales synchronously" with the view, the wrong way).
   - Required: the PDF behaves like a picture inside the node. Content size relative to the node is constant at any board zoom and note scale; only the node's own −/+/Fit width change it.
   - Implementation: keep the device-resolution layout from 1e04f7e, but pass the viewer an effective zoom = pdfZoom × boardZoom × noteScale (#zoom=<n>), debounced after zoom gestures (~150 ms). Fit width already scales correctly, so keep it.
   - Pure function + tests for several board zooms: the ratio contentWidth/nodeWidth must stay constant.
   - If the built-in viewer re-scrolls to the top on every zoom change, keep the scroll position by reading/writing it on the iframe where possible. If that isn't possible, say so in the report.

TASK AUD2 — item 2. Files: src/audio/**, tests.
2. Recordings taken out of the dictaphone (standalone audio nodes) can be put BACK:
   - drag an audio node (any single-file audio node) onto a dictaphone node and drop it → it becomes a recording at the end of the list (name = the node name);
   - the standalone node is removed;
   - one Undo step restores both;
   - Ctrl while dropping copies instead of moving.
   - While an audio node is being dragged over a dictaphone, show a drop highlight on the dictaphone (accent outline + "Drop to add recording").
   - Hook into the existing board drag/move gesture (find how other "drop into node" features do it, e.g. module insert into notes or Tierlist drop). If you need a hook in the board drag, add a small isolated hunk and name it in the report.
Tests: drop-in move/copy and undo; a non-audio node is ignored.

TASK VID2 — items 5 and 6. Files: src/video/**, src/media-ui/**, the node RMB registration hunk, tests.
5. Video node RMB: "Hide node frame" / "Show node frame", exactly like YouTube — the same `Note.frameHidden` flag; reuse the YouTube implementation pattern. The node is still draggable from the video area when the frame is hidden: a plain click = play/pause, dragging beyond the threshold moves the node.
6. The volume popover is too large.
   - Make the vertical slider roughly the width of the volume button (about 28–32 px wide, about 90 px tall) and visually harmonious with the button.
   - One consistent surface: the popover background must be the SAME grey as the button's hover/active background — today they are two different greys.
   - Use the media design tokens: track rgba(255,255,255,.25), fill #fff, a small white thumb, 6 px radius, a subtle shadow.
   - Keep the hover-grace behaviour.
Tests: the size constants; frameHidden for video in the serializers, if any hunk is needed.

TASK TIER8 — item 8: Tierlist cards for media nodes. Files: src/tierlist/**, tests.
8. When a VIDEO node is dropped into a Tierlist (kind:"note" card targeting a video node):
   - the card shows a small preview frame taken from the MIDDLE of the video (seek to duration/2, draw it to a canvas once, then cache it per file in memory for the session);
   - the card height matches the image cards.
   When an AUDIO node is dropped in:
   - the card shows a big round play button plus the node name;
   - pressing it plays the audio right in the Tierlist (play/pause toggles; only one card plays at a time);
   - no seek bar is needed.
   When a YOUTUBE node is dropped in:
   - the card shows its thumbnail (i.ytimg.com hqdefault) with the title.
   For all of them, a missing file or target keeps today's behaviour.
Tests: card preview kinds per target type, and the middle-frame time computation.

TASK FILES — items 3, 4 and 9: dropping files into hive. Files: src/formats/** (text routing), src/source/** (no-picker variant), the drop routing in src/attachments/dropDispatch.ts or service.ts (small hunk, coordinate by re-reading), tests.
3. An OS drop of a `.md` file creates an ordinary TEXT NOTE — type "note", not a Format node.
   - Its text is the file content; its name comes from the file name without the extension, kept unique.
   - Its size fits the amount of text right away: use the existing text-fit/auto-height logic, so the node isn't a tiny box with a scrollbar.
   - Large files: cap the initial height sensibly and say what you chose.
4. Any OTHER text file (json, txt, py, css, …, i.e. the TEXT_FORMAT_LANGUAGES list except md) becomes a Format ("file") node, as today.
   - Review https://github.com/reteren/marknote (the user's repo) for how it handles text formats: syntax highlighting, which extensions, encoding detection, read-only vs edit, large-file handling, line endings. Align our Format node with it where reasonable.
   - Write a short note in your report of what you adopted.
   - Don't add npm packages without asking.
9. Dropping any file that hive does NOT support creates a Source node with that file path. The examples are an .exe, or any non-text and non-media format.
   - Behaviour is the normal Source node: description, and "Open", which opens the file with the default Windows app.
   - One difference: this Source node has NO "Choose file…" button. Store a flag, e.g. `source.locked?: true`, or derive it, and hide that button.
   - Don't copy the file into the project: Source links to the original path, as Source does today.
   Routing order for OS drops onto empty board:
   1. image;
   2. pdf / audio / video;
   3. md → note;
   4. other text → Format;
   5. anything else → Source.
   Drops onto specific targets (Tierlist, editor, dictaphone) keep their own handlers.
Tests: the routing table per extension, md → note with fitted height, unsupported → locked Source without the Choose button.

Reports: one worker_done per task, with what changed, the shared hunks, and how to check by hand.
