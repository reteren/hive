TASK D — R5.4–R5.5 Calculator bank mode and node-linked rows (browser port 1434)

Read C:\hive\docs\handoff\r5common.md first.
Your files: new src/calculator/BankPanel.svelte (mounted by worker C inside CalculatorBody with props {note, data}), new src/calculator/bank.ts (pure logic), new src/calculator/bankActions.svelte.ts (history commands + link listener), tests. Link rules for calculators (src/links/rules.ts) — ask the coordinator before editing it.

1. Bank: "Create bank" in the calculator → name + initial sum; shows Initial, rows, Remaining = initial − Σ amounts (also negative, shown in red). Edit initial/name; remove bank (asks if rows exist). Rows: label + amount, add manual row, edit amount (recomputes at once, H26), delete row. One Undo step each.
2. Node-linked rows: drawing a STRONG line from any node (not beacon/ME) to a calculator adds a row linked to that node (sourceNoteId), label = the node's current name (display follows renames live while the node exists; stored label updated too), amount empty/0 until typed (focus the amount field). Removing that link: keep the row (ask? → keep, detach sourceNoteId; say what you chose). Deleting the node: the row and amount stay, the row shows the last known name with a subtle "source deleted" marker (H27). Undo must not duplicate rows (link creation + row creation in ONE history step: use the links lifecycle listener carefully or hook the link command — explain your approach; ask the coordinator if a seam in src/links is needed).
3. The bank lives in the shared CalculatorData, so mirrors (same name) show the same bank (worker E).
4. Tests: 100 − 20 = 80, edit 20→30 = 70; delete source note keeps row; undo/redo of linked row creation doesn't duplicate.
