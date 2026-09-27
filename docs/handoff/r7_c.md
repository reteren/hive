TASK C — R7.3 List + R7.7 Random Choice

Read C:\hive\docs\handoff\r7common.md first.
Your files: new src/list/** and src/random/** (bodies, logic, actions, init), link rule tweaks for list/random in src/links/rules.ts only if needed (re-read first), tests.

List (kind "list"):
1. Rows = listItems. Add a row: "+ Add" → a small picker searching board objects by name (reuse the search matching from src/search), or type plain text (targetId null); drag a board node onto the List also adds a row (use the existing drop target registry src/selection/dropTargets.ts). Reorder rows by dragging (pointer events, not HTML5 DnD — it doesn't work in the Tauri webview), delete row (×). Each action one Undo step.
2. Row shows the live name of the target (label snapshot kept for deleted targets); click → camera jump + select the target (src/navigation/navigate.ts); deleted target → row greyed "missing" until removed.
Random Choice (kind "random"):
3. Linked to a List by a strong line (decide direction; say which) — shows "Pick" button; picks uniformly at random from that list's rows (excluding missing targets? — include text rows, exclude missing; say), stores randomPick (one Undo step), shows the picked label big with "from <List name>"; click → jump to target. No/empty list → explanation text.
Tests: list ops, missing targets, random pick distribution sanity (seeded RNG injectable), empty cases.
