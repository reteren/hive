TASK A — R6.1 Trash core (soft delete, restore, permanent delete, persistence)

Read C:\hive\docs\handoff\r6common.md first.
Your files: new src/trash/** (trash.ts logic, trashActions.svelte.ts commands), every delete path for notes/beacons/zones (find them: note delete commands, clipboard delete (not cut), zone deleteZonesAction, beacon delete, R5 nodes) — change them to move into the trash through ONE shared function; src/project/index.ts + src/project/persistence.svelte.ts (trash lines only), Rust side only if note .md handling requires (project.rs moves removed .md files to .hive/removed — keep that; restoring must write the .md again through the normal save), tests.

1. moveToTrash(noteIds, zoneIds) → one TrashEntry with full notes (text included), zones, and all links touching those notes; removes them from the board; one Undo step (undo removes the entry and puts everything back).
2. restoreTrashEntry(entryId) → puts notes/zones back at their positions; links only where both ends exist; name collisions (another note now has the same name) → rename the restored note with the usual unique-name rule and report it; one Undo step. previewRestore(entryId) → {links restored, links broken, renamed} for the UI (I23).
3. deletePermanently(entryId), emptyTrash() — not undoable (UI asks). Calculator data of permanently deleted calculators and tierlist previews of deleted originals keep their current rules.
4. Persist trash in board.json (`trash`), validate on load (drop invalid entries with a warning).
5. Tests: delete→trash→restore round trip with text, links partial restore, name collision rename, undo of move/restore, persistence round trip.
Expose the API for worker B (UI): list entries (sorted newest first, with a short summary), previewRestore, restore, deletePermanently, emptyTrash.
