# R3 integration review

Reviewed committed `HEAD` (`96f452e`). `npm run check`, `npm test` (45 files / 267 tests), and `cargo test` pass; the Vite app and transformed module endpoint returned HTTP 200 on port 1446, and the server was stopped. The issues below are reproducible code-path defects not covered by those checks.

## Findings

### P1 — Inserting a shared external module removes its other assignments

`app/src/modules/moduleActions.svelte.ts:119,134,157`

**Reproduction:** Create an external Importance or Purpose, connect it strongly to two notes, then drag it onto one of those notes to insert it. The insertion removes every link attached to the module and deletes the module, so the other note silently loses its Importance/Purpose too.

**Fix:** Remove only the link to the insertion target and keep the external module plus its remaining links; remove the module only when it has no remaining targets.

### P1 — Unlinking the active live-text source can revive an older source and split Undo

`app/src/transfer/logic.ts:80-93`; `app/src/transfer/sync.svelte.ts:256-267`; `app/src/links/operations.ts:29-47`

**Reproduction:** Connect A → task B and accept the transfer, then connect C → B and accept replacement. Unlink C → B: the older A link becomes active again and rewrites B, and the reactive sync records a separate `Transfer text` history command after the `Unlink` command. The first Undo restores B's text while leaving C unlinked, so one unlink action needs two Undos and does not preserve the last copied text as the sync comment describes.

**Fix:** Keep superseded sources inactive after the selected source is removed and leave B's text unchanged, or explicitly include a chosen fallback and its text change inside the unlink command.

### P1 — A linked Importance can be duplicated as an embedded Importance

`app/src/modules/commands.ts:6-10`; `app/src/modules/moduleActions.svelte.ts:61-66`; `app/src/modules/moduleLogic.ts:49-53`

**Reproduction:** Link an external Importance to a note, right-click that note, choose “Add Importance,” and select another level. The picker writes `note.importance` without checking the linked source, leaving both values attached to that target; the embedded value then silently masks the external value.

**Fix:** Guard `setImportance` against an existing linked source and make the menu/picker offer an explicit edit or conversion of that source instead of creating a second Importance.

### P2 — Weak links are accepted for both external module types

`app/src/links/rules.ts:42-43`

**Reproduction:** Create a standalone Purpose or Importance, activate the weak-line tool, and connect it to a note. `linkRefusalReason` returns no refusal for weak links; module resolution ignores weak edges, so the user gets a visible line that does not apply the module.

**Fix:** Reject `kind !== "strong"` for any link whose endpoint is a module before applying the type-specific Importance uniqueness checks.

### P2 — Project switch leaves the task panel state open

`app/src/project/persistence.svelte.ts:175-182`; `app/src/tasks/tasksPanelState.svelte.ts:1-12`

**Reproduction:** Open the Tasks panel, expand History, then open another project. `resetProjectScopedState` clears navigation/search/tool state but does not reset `tasksPanel.open` or `historyOpen`, so the panel remains open in the new project without the user reopening it. It also does not clear the module drop preview in `moduleActions.svelte.ts:31,95-99`.

**Fix:** Reset the task panel and clear module picker/drop-preview state as part of the project-scoped reset.
