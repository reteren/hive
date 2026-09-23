# R0.1–R0.4 integration review

Reviewed committed `HEAD` (`8329c85`); excluded the in-progress R0.5 settings work. `npm run check` passes with 0 errors and 0 warnings; `npm test` passes all 18 tests.

## Findings, ranked

1. **High — `Shift+Tab` disables reverse keyboard navigation.** [KeyDispatcher.svelte](../../app/src/commands/KeyDispatcher.svelte#L20) matches every registered command at window scope and calls `preventDefault()`; [gridCommands.ts](../../app/src/board/gridCommands.ts#L26) assigns `Shift+Tab` to Snapgrid. Repro: tab to any toolbar or panel control, then press `Shift+Tab`; Snapgrid toggles and focus does not move backwards. Use a non-reserved binding for Snapgrid, or otherwise preserve native Tab traversal.

2. **Medium — `Space` steals activation from a focused toolbar button.** [KeyDispatcher.svelte](../../app/src/commands/KeyDispatcher.svelte#L15) dispatches `Space` without checking whether a native control is focused, then prevents its default; [cameraCommands.ts](../../app/src/board/cameraCommands.ts#L22) binds it to Home. Repro: pan or zoom, tab to Zoom In, and press Space; Home runs instead of the focused button's normal activation (or runs before its click on engines that still synthesize one). Skip activation-key shortcuts when a button is focused, or move Home to a non-activation key.

3. **Medium — coordinates are offset twice when the right panel is in the grid.** [App.svelte](../../app/src/App.svelte#L81) places the overlay inside `.center`, whose grid column already ends before the right panel ([columns](../../app/src/App.svelte#L37)); its `right` and `max-width` also subtract the panel width. Repro at 480×360 with the panel open: the center is about 290px wide, but the overlay is inset by 164px and constrained to 116px, so the coordinates sit far left of the board's bottom-right and their nowrap contents can overflow. Use an 8px inset and a center-relative max width while the panel occupies its grid column; apply the panel offset only at the breakpoint where the panel floats over the board.

4. **Low — camera and command dispatch use different text-entry guards.** [KeyDispatcher.svelte](../../app/src/commands/KeyDispatcher.svelte#L6) excludes `select` and checks the `contenteditable` attribute; [cameraInput.ts](../../app/src/board/cameraInput.ts#L232) excludes only inputs, textareas, and `isContentEditable`. Repro once a select is present (likely in R1): focus it and press W; the camera handler prevents the control's keyboard behavior and pans the board. Move the shared target check to one helper used by both handlers so new editor controls receive consistent keyboard handling.

## Reviewed without a finding

Wheel zoom is attached to the board, so toolbar and panel scrolling cannot zoom the board. MMB drag uses pointer capture and ends on pointer up, cancel, lost capture, or window blur. Cursor-anchored zoom, limits, and camera coordinate conversion are consistent; GridLayer redraws on camera/viewport/grid visibility or step changes, scales its backing canvas for DPR, and keeps line density bounded. The registered commands have mouse controls and key-binding tooltips, including step up/down in the Display panel; labels are English and the controls perform actions.
