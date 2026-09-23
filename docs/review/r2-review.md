# R2 integration review

Reviewed the current `app/src` working tree. Link shape/scissors implementation was treated as in progress and is not assessed here.

## Findings (highest severity first)

### P1 — Project switch retains navigation and line-tool state

**Location:** [app/src/project/persistence.svelte.ts](../../app/src/project/persistence.svelte.ts:133)

`applyProject()` clears the editor, note/link selection, and Undo history, then replaces notes and links, but leaves `tool.active`, `lineInteraction`, navigation history, and the pinned Objects panel search untouched. Repro: in project A activate C and click a source note, then open project B; the line tool still tries to link from A's now-missing note ID, so every attempted link fails until the draft/tool is manually reset. Also use Alt+Left after a teleport in B: navigation can move the camera to a snapshot from A; a pinned search can likewise filter B to stale IDs and appear empty. Reset these project-scoped states in the same switch path (`cancelLineDraft`, select tool, `clearNavigationHistory`, and clear/close search and pinned-panel state).

### P2 — Holding T cycles line shapes repeatedly

**Location:** [app/src/search/commands.svelte.ts](../../app/src/search/commands.svelte.ts:9), [app/src/commands/KeyDispatcher.svelte](../../app/src/commands/KeyDispatcher.svelte:32)

Repro: activate C or V and hold T briefly. `search.open` delegates to `line.cycleShape`, but the dispatcher suppresses repeats based on `search.open.isActive()` (false while search is closed), so each key repeat advances the line shape again. Give the line-tool branch repeat-aware state/dispatch, or make this shortcut execute once per key press.

### P2 — Escape cancels the line tool before allowing Objects to close

**Location:** [app/src/board/Board.svelte](../../app/src/board/Board.svelte:71), [app/src/navigation/ObjectsPanel.svelte](../../app/src/navigation/ObjectsPanel.svelte:56)

Repro: activate C, open Objects, focus a panel button (for example Pin search), then press Escape. Board's window capture handler deactivates the line tool and calls `preventDefault`; the Objects handler then returns because the event is default-prevented, so the panel stays open until a second Escape. Resolve the active overlay first (as with editor/create-menu priority), and only cancel the tool on a later Escape.

## Verification

- `npm run check` — passed (0 errors, 0 warnings).
- `npm test` — passed (27 files, 156 tests).
- Vite started on port 1446 and returned HTTP 200; the server was stopped.
