Debug 17 after 1.4.0 (01.10). The items use the user's numbering. Rules as in C:\hive\docs\handoff\d8common.md:
- headless Edge is blocked for workers; the coordinator tests with a real mouse;
- runes only in .svelte/.svelte.ts;
- send worker_done in Russian, once, and check that it returned ok;
- `npm run check` + `npm test` must be green.

Two tasks run in parallel in C:\hive:
- Stay in your own files. In shared files make small, isolated hunks, name them in your report, and re-read the file right before you edit it.
- Commit only your own hunks. No attribution.
- Ask when unsure.

The coordinator does item 2 personally (src/overview/**: Alt labels say "GIF" for GIF images). Don't touch it.

TASK MENU — items 1 and 3: right-click menus. Files:
- src/notes/noteMenu.ts;
- the note menu in src/notes/NotesLayer.svelte;
- src/beacons/BeaconMenu.svelte;
- the zone menu in src/zones/ZonesLayer.svelte;
- a new shared helper, e.g. src/commands/menuShortcut.ts (one function that returns a command's current key label; reuse the keyLabel idea from src/beacons/focusCommands.ts, but show it as separate grey text);
- small hunks wherever the "notes.copyLink" / archive / task / pro / con items are registered (visibility for images);
- tests.

1. Image nodes (kind "image") — the RMB menu shows ONLY:
   - "Copy link to image" for a picture, or "Copy link to gif" for a GIF (image.mime === "image/gif") — the same action as "Copy link to note";
   - "Archive";
   - for a GIF, also the existing "Stop gif" / "Play gif" item, together with Copy link to gif and Archive. Today a right-click on the GIF surface shows only Stop/Play — that filter in NotesLayer `activeNoteMenuItems` must now keep these three.
   - Plus the three universal items of item 3.
   - Nothing else: no Mark as task, Add plus, Add minus, Show header, and so on. Keep the other items of ordinary nodes unchanged.
2. Item 3 — add three items to the RMB menu of EVERY object: every node kind (notes, images, Calendar, Time, …), beacons, and zones.
   - "Scale", with a small grey hint on the right showing the current key of the scale command ("S"; read it from the command registry so a rebind updates it). It runs the same thing as pressing S with that object selected: select the object if it isn't, then run "select.scale".
   - "Grab", with the hint "G": the same as pressing G on the object (select it, then "select.move").
   - "Delete", with the hint "Del / Backspace" (the actual keys of the delete command): the same as pressing Delete on the object. It is one Undo step, as today.
   - For ZONES: Grab from the menu first switches to zone mode and zone-move mode (the same state the zone tools use when the user moves zones), selects that zone, and starts moving it. Scale and Delete on a zone also act on the zone, the way the zone tools/keys already do — find the existing zone scale/delete paths and reuse them.
   - Put these three at the bottom of each menu, under a thin divider.
   - Look: label left, hint right-aligned, grey (#8a8a8a-ish), smaller, `font-variant-numeric: tabular-nums`; the same row height as the other items.
   - Multi-selection: if the right-clicked object is part of the current selection, Scale/Grab/Delete act on the whole selection (as the keys do); otherwise they select only that object first.
3. Tests: per-kind menu contents (image vs gif vs note vs beacon), that the hint follows the bound key, and that zone Grab sets zone mode + move.

TASK TIERIMG — item 4: images in Tierlist show as text cards. Files: src/tierlist/** and tierlist tests.
4. Screenshot: Tierlist cards show "rebuffer video / No text" and "Image 2 / No text". These are `kind: "note"` cards whose target is a board IMAGE node (the user dragged image nodes from the board into the Tierlist). The preview must show the picture, not the name + "No text":
   - for a target note of type "image", render its image (aspect preserved, card height like the image cards; mirrored by flipX/flipY like the board node);
   - a GIF target uses GifView with the Tierlist playback rules (the hover/selected/stopped behaviour from d21, keyed to this card);
   - a missing file shows the AttachmentImage error box;
   - a deleted target keeps today's "content missing" behaviour.
   Also re-check that real image cards (`kind: "image"`, added by drop/paste/row menu) still render after the d21 GIF changes. Reproduce both in tests (tierCardPreview for an image target + a component/unit test if the existing tests allow).

Reports: one worker_done per task, listing what changed, the shared hunks, and how to check it by hand.
