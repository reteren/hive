# d43 drawing d3 — bounded long-stroke state

## Change

Added a 128 MiB budget for transient brush state. A 512 × 512 stroke tile uses an estimated 4,893,352 GPU bytes for its two RGBA8 mip chains and two R32F path-position buffers; least-recently-touched tiles spill their complete current and preview state to CPU memory, then restore on demand. Spill snapshots use sparse pixel entries when that costs less than the raw buffers, retaining coverage, pass, blend, and path-position data so a return to an earlier tile continues the same soft-brush stroke.

Finishing a spilled stroke streams one tile at a time through the existing level-aware paint/erase path. It plans Undo snapshots from the exact touched tile rectangles, applies finer-level changes before source-level changes, commits changed drawing tiles once, and records one history action for the entire gesture. Brush, spray, and eraser use the streamed path; the live preview rehydrates the viewport tiles it needs.

## Synthetic probe

The Vitest probe drew a 322-tile forward stroke and returned across it, exercising spill, restore, and final streaming at zoom 0.05 and 1. The fake GPU models 512 active pixels in each saved tile buffer; GPU bytes are estimated from the real declared texture formats and mip levels, and CPU spill bytes are the packed synthetic snapshots.

| Zoom | Stroke tiles | GPU state peak | GPU budget | CPU spill after streaming | Pieces streamed |
|---:|---:|---:|---:|---:|---:|
| 0.05 | 648 | 132,120,504 B (125.98 MiB) | 128 MiB | 7,630,848 B (7.28 MiB) | 648 |
| 1 | 648 | 132,120,504 B (125.98 MiB) | 128 MiB | 7,630,848 B (7.28 MiB) | 648 |

The simulation also observed 1,865 spills and 1,244 restores per zoom. These results verify the budget and streaming behavior in the fake GPU harness; they do not measure WebGL readback latency or physical GPU memory.

## Verification

- Drawing suites: 32 passed.
- Full `npm test`: 1,461 passed across 221 files.
- Latest `npm run check`: reports errors in the concurrently changed `app/src/project/persistence.svelte.ts` (`indexTemplate` possibly undefined; one run also found `reservedDeltaFiles` undefined). That file is outside drawing d3 and was not changed here; an earlier check before that shared edit reported 0 errors and warnings.

## Files changed

- `app/src/drawing/brush.ts`
- `app/src/drawing/eraser.ts`
- `app/src/drawing/gpu/glEngine.ts`
- `app/src/drawing/history.ts`
- `app/src/drawing/stroke.svelte.ts`
- `app/tests/drawing.strokeMemory.test.ts`
