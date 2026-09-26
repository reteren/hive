TASK F — R5.7–R5.8 Tierlist (browser port 1436)

Read C:\hive\docs\handoff\r5common.md first.
Your files: new src/tierlist/** (logic, TierlistBody.svelte, actions, init), tests app/tests/tierlist*.test.ts. Drag from the board into the tierlist may need a hook in SelectionLayer's drop handling (like moduleDrop) — ask the coordinator for the exact seam.

1. New Tierlist: default rows S, A, B, C, D, F with distinct colours (S red, A orange, B yellow, C green, D blue, F purple — muted to the dark theme). Row label cell (name on colour) + card area; rows: add (bottom "+ row"), rename (double-click label), recolour (RMB on label → small palette), delete (RMB → delete; non-empty row asks: move cards to the row below / delete cards / cancel), reorder (drag the label).
2. Cards: text cards (double-click empty area of a row → new text card, edit inline; square-ish chips), node previews: drag a board node onto a row → a card with kind "note" (the node itself stays where it was on the board — it's a visual duplicate), showing the LIVE name + first lines of the original; original deleted → "content missing". Cards drag between rows and within a row (order persists). Delete card (select + Delete, or ×) never touches the original. Clicking a node card may jump the camera to the original (nice-to-have, say if done).
3. Every change = one Undo step; data in note.tiers (persisted already). Tierlist node grows in height with its rows; width resizable within limits.
4. Tests: add/rename/delete/reorder rows, move cards, delete non-empty row choices, content-missing state, undo.
