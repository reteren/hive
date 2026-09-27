TASK B — debug 8: p.4 List live dragging, p.5 kind icons, p.7 +add closes on blur

Read C:\hive\docs\handoff\d8common.md and debug 8.md first.
Your files: src/list/**, src/tierlist/** (only the cross-drop seam so List rows can drop into a Tierlist and Tierlist cards into a List — keep Tierlist behaviour otherwise), tests.

1. Dragging a List row: the row itself follows the pointer (50% opacity) and the other rows move apart LIVE to open the slot where it will land (animated, respects reduce-motion); release drops it. Pointer events only (no HTML5 DnD). Same mechanic as Tierlist: drag a row into ANOTHER List (moves it there) or into a Tierlist (becomes a card: node rows → node-preview card, text rows → text card). One Undo step. Esc cancels.
2. Each row shows an icon on the right telling what it is: note, task, beacon, zone, module (importance/purpose/mood/mark as), R5/R7 kinds (goal, progress, calculator, tierlist, statistics, list, source, …), plain text, missing target. Design a compact consistent SVG icon set (stroke icons, theme colours); tooltip with the kind name.
3. "+ Add" picker closes when focus leaves it (click on another node, empty board, Esc) — board-anchored popup rules (src/ui/boardAnchor.ts).
Tests: reorder index logic, cross-list move, list→tierlist conversion, icon mapping.
