TASK C — R6.2–R6.3 Archive

Read C:\hive\docs\handoff\r6common.md first.
Your files: new src/archive/** (logic, actions, ArchiveNodeBody.svelte, init), the note RMB menu item via src/notes/noteMenu.ts registry (registerNoteMenuItem — no edits to other items), src/project/index.ts + src/project/persistence.svelte.ts (archive lines only; worker A edits trash lines — re-read before editing), tests.

1. RMB note → "Archive" (effective key: none by default; command "Archive selected" in F3). Archiving removes the note(s) from the board into archive.entries with their links; one Undo step. Works for notes, tasks, pro/con, R5 nodes; not for beacons/zones/modules? — modules and R5 nodes may be archived too; beacons and zones cannot (say what you decided).
2. Archive node (kind "archive", Q menu): list of archived items (name, kind icon, archived date, text preview); per item: "Restore here" = old position, "Restore to screen centre" (current camera centre), "Duplicate near Archive" (independent copy next to this Archive node, new id and unique name, no links, original stays archived), "Delete permanently" (confirm, not undoable). Restores bring back links whose other end exists; name collision → unique rename, reported (H34, I23). Restore/duplicate = one Undo step.
3. Before a destructive change the conflict (name/place) is visible (ROADMAP R6.2): show a small notice in the item row when restoring would rename or would land on top of another node (then restore still allowed).
4. Persist archive in board.json (`archive`), validate on load.
5. Tests: archive/restore both ways, duplicate independence, links partial, rename, undo, persistence.
