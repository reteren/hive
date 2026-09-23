# R1 wave 1 integration review

Reviewed the committed `git HEAD` for R1.1–R1.6. Concurrent uncommitted work in the project, clipboard, and group-scale areas was excluded from findings.

## Findings

### P1 — Opening another project keeps the previous project’s history and interaction state

**Location:** `app/src/project/persistence.svelte.ts:89–111`

`applyProject` replaces the board but does not clear unified history or reset `editing.noteId` and selection state. Repro: edit/move a note, leave it selected or open in the editor, then open a copied project with the same note IDs and press Ctrl+Z; an old history closure can remove or mutate the note in the newly loaded project, and an editor that remains mounted can continue with its previous document. Reset editor/session and selection state and clear history before replacing the board.

### P1 — R1.5 Copy, Paste, Cut, and Delete are absent from the committed command set

**Location:** `app/src/notes/noteCommands.ts:50–56`; `app/src/selection/selection.svelte.ts:100–115`

The note command set only registers the Q create-menu command; selection registers only Escape and G. Repro: select a note and invoke Ctrl+C, Ctrl+V, Ctrl+X, or Delete; no operation runs. Implement these as mouse-reachable and keyboard commands with board changes recorded in unified history; soft-delete note files so Undo/Redo can restore them.

### P2 — Board Escape handling prevents selection clear and does not close the Undo Log

**Location:** `app/src/board/Board.svelte:45–54`; `app/src/selection/selection.svelte.ts:100–108`; `app/src/ui/UndoLog.svelte:60–80`

When Escape is pressed outside a text input, Board prevents the event and closes editing/create-menu state. The dispatcher then ignores the default-prevented event, so the registered `select.clear` command cannot run; Undo Log has no Escape close handler. Repro: select a note and press Escape—the selection remains; open Undo Log and press Escape—it stays open. Give Escape one prioritized owner (rename/editor, transient menu/panel, then selection) instead of consuming it in Board unconditionally.

### P2 — Clicking the Create menu starts a blank-board marquee

**Location:** `app/src/selection/SelectionLayer.svelte:156–157, 206–216, 412–423`; `app/src/notes/CreateMenu.svelte:11–12`

The capture-phase pointer handler ignores the overlap picker, notes, and `[data-selection-ignore]`, but the Create menu only has `data-create-menu`. Repro: select a note, open Q, then click the menu pin, close control, or Note; pointerdown starts an unstarted marquee and pointerup clears the selection. Ignore `[data-create-menu]` in SelectionLayer or mark the menu with `data-selection-ignore`.

## Verification

- `npm run check` — passed, 0 errors and warnings.
- `npm test` — passed, 13 files / 73 tests.
- `cargo test` in `app/src-tauri` — passed, 7 Rust tests.
