TASK B — R6.1 Trash UI: panel + Trash node

Read C:\hive\docs\handoff\r6common.md first.
Your files: new src/trash/TrashPanel.svelte, src/trash/TrashNodeBody.svelte, src/trash/TrashList.svelte (shared list component), trash UI init (register body, commands), the top-bar button next to Tasks/Objects (src/ui/TopBar.svelte or wherever Tasks/Objects buttons live — minimal edit), tests.
Depends on worker A's API in src/trash/ (list, previewRestore, restore, deletePermanently, emptyTrash). Ask A (via the coordinator) for the exact names; build against them.

1. Panel "Trash" (top-right button + F3 command "Open trash"), same style as Tasks/Objects panels: entries newest first — icon by kind, name(s) ("Note 3", "Zone Work", "3 objects"), deleted time; per entry: Restore, Delete permanently (confirm). Footer: "Empty trash" (confirm, shows count). Empty state text.
2. Restore flow: clicking Restore shows a compact preview (links restored / links that stay broken / renamed) with Confirm/Cancel (I23); skip the preview when nothing is broken or renamed.
3. Trash node (kind "trash", Q menu): same list inside the node (compact), scrolls inside, same actions. All Trash nodes and the panel show the same data live.
4. After restore, camera does not jump; restored objects get selected (one Undo step handled by A's command).
Tests for list formatting/sorting/summary logic.
