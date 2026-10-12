# d43 c2 — pressing nodes on the far canvas

## Changes

- Added a min-LOD press resolver in `app/src/selection/noteMoveIntent.ts`. It prefers an existing `[data-note-id]`, otherwise accepts the topmost exact spatial hit only at `lod.tier === "min"` and when the event is not on a feature surface.
- `SelectionLayer.svelte` resolves fallback candidates with `queryPoint(world)` and `hitTestNotes`, preserving exact bounds, dimming rules, and cached paint order. A fallback press follows the existing header path for selection and move-candidate gestures; Alt/Ctrl handling remains on the existing paths. Double-click resolves the canvas note for the same editing-selection behavior, and an empty hit leaves marquee behavior unchanged.
- Right-click stores a one-shot canvas note ID in selection state. The existing `NotesLayer` context-menu owner consumes it when no note element is present, and uses its normal anchor calculation at the current camera zoom. The coordinator approved this minimal `NotesLayer.svelte` integration because c2 otherwise could not pass the note identity to the menu owner.

## Files changed

- `app/src/selection/SelectionLayer.svelte`
- `app/src/selection/noteMoveIntent.ts`
- `app/src/selection/selection.svelte.ts`
- `app/tests/selection.test.ts`
- `app/src/notes/NotesLayer.svelte` — approved context-menu handoff only
- `docs/handoff/d43_report_c2.md`

## Verification

- `npm test -- tests/selection.test.ts` — passed, 26 tests.
- `npm run check` — blocked by concurrent a2 work in `app/src/attachments/service.ts:250` (`MediaKind` compared with `"image"`); it also reported two warnings in the concurrent `ImportProgress.svelte` change. No c2 diagnostics were reported.
- Full `npm test` — 196 test files passed and 26 failed in the shared tree. The failures originate from concurrent a2 work: `service.ts` uses `$state` from a plain `.ts` module, causing 25 suites to fail at import, and `runesPlacement.test.ts` flags the same file. The c2 selection tests pass within the full run as well.
- No c2 performance benchmark was run; the new fallback runs only on eligible min-LOD presses and queries the existing spatial index.

## Remaining

Rerun `npm run check` and the full `npm test` after the a2 owner fixes `attachments/service.ts`; the coordinator said integration will rerun them.
