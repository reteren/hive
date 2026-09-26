TASK C — R5.3 Calculator core: expressions, history, node UI (browser port 1433)

Read C:\hive\docs\handoff\r5common.md first.
Your files: new src/calculator/expression.ts (parser/evaluator), new src/calculator/CalculatorBody.svelte (the whole calculator UI incl. a bank section slot — worker D builds the bank part as its own component BankPanel.svelte that you mount inside your body; agree the props with D via the coordinator: `{note, data}`), new src/calculator/calculatorActions.svelte.ts (history commands for entries), calculator init registering the body, tests.
Data: calculatorData(note.name) / setCalculatorData (shared by mirrors — worker E owns persistence and mirroring rules; you just read/write through those functions).

1. Expression evaluator (no eval): numbers (decimal point and comma accepted), + − × ÷ (also * /), parentheses, unary minus, %, ^; references to earlier results as `#n` (entry number) — optional, say if you add it. Errors return a message, never throw to UI.
2. Calculator body: an input line (Enter adds an entry), the history list (expression = result), click an entry to edit it (Enter saves, Esc cancels) → all results recomputed; an invalid edit shows its error on that line only, other results stay. Delete an entry (small ×). Every add/edit/delete = one Undo step (history command updating calculatorData via setCalculatorData).
3. Keyboard focus inside the calculator must not trigger board hotkeys (use the existing text-editing target detection). The node must be movable/selectable like other nodes (header drag).
4. Tests: parser (precedence, unary, parentheses, errors, comma decimals), recompute after edit, error isolation.
