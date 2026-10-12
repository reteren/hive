# d43 drawing d2 — implementation report

## Implemented

- `DrawingLayer` now selects one target LOD for the viewport, draws only indexed native levels coarser than that target, and uses a bounded target-tile grid for the selected level plus all finer levels. It coarsens the target when needed so the composite grid is at most 64 tiles and the estimated native-visible tiles plus one source batch are at most 84 (leaving 12 of the 96 resident slots for composite input).
- Added an incremental coarse composite cache. It gathers only indexed source tiles that overlap each target tile, composites them in the existing coarsest-to-finest source-over order, and loads at most 12 source tiles per idle slice. Cache textures are non-mipmapped 512² tiles with a 64 MiB ceiling; stale entries are invalidated by content revision and reused/cleared in the idle worker rather than deleted on the stroke commit path.
- Visible native fallback keys are pinned in the drawing store while the composite worker loads source batches. The store now exposes content revision and resident-tile GPU-byte telemetry for cache invalidation and measurement.
- Added a synthetic in-test probe for a sparse diagonal drawing crossing a 50,000 × 50,000 u area at zoom 0.05, 0.3, and 1.

## Probe results

The `vite-node` probe used a 1400 × 900 viewport at DPR 1 and a fake GPU/store that exercises the actual LOD planner and incremental cache loader. Tile counts are from a synthetic level-0 diagonal with 1,955 indexed source tiles; GPU bytes are calculated from the declared RGBA8 mip-chain and cache texture allocations, so they are estimates rather than hardware measurements.

| Zoom | Target level | Source tiles loaded | Non-empty composite tiles drawn/frame | Max source load batch | Estimated resident GPU bytes |
|---:|---:|---:|---:|---:|---:|
| 0.05 | 4 | 96 | 6 | 12 | 184,549,440 (~176 MiB) |
| 0.3 | 2 | 16 | 9 | 5 | 47,535,456 (~45.3 MiB) |
| 1 | 0 | 5 | 5 | 1 | 43,690,670 (~41.7 MiB) |

The configured combined clean-tile and composite allocation ceiling in this probe is about 192 MiB: 96 mipmapped tile slots plus 64 MiB of composites. The far-zoom case used all 96 tile slots while incrementally building the visible target composites; the frame drew six non-empty composite tiles instead of traversing the fine source keys. These are counts and allocation estimates, not browser frame-time or physical GPU measurements.

## Verification

- Targeted drawing suites: 48 tests passed (`drawing.core`, `drawing.lod`, `drawing.selection`, `drawing.eraseFill`).
- `npm run check`: 0 errors, 0 warnings.
- Full `npm test`: 1,453 passed; 3 unrelated failures remain in `meBeacon.test.ts`, `smoothLines.test.ts`, and `zonesMembership.test.ts`.
- No Rust files changed; `cargo test` was not run.

## Remaining work / limits

- Priority 3 is not implemented: long brush strokes still retain GPU ping-pong state for every touched stroke tile until finish; there is no fixed transient-byte budget or spill/section-commit path preserving one Undo step.
- The synthetic probe has no real WebGL context, so it does not establish frame or stroke timing. `drawQuads` still issues one GL draw per tile; the sparse probe drew only 5–9 non-empty tile quads per frame, so batching was left for a real frame-time measurement.
- Fine-only content is aggregated incrementally, so it can be incomplete for the short interval while a new or invalidated composite is being built. Existing coarser native tiles remain the visual fallback during that work.
- The existing 96-tile residency ceiling remains soft when dirty tiles cannot be evicted before their save completes.

## Files changed

- `app/src/drawing/DrawingLayer.svelte`
- `app/src/drawing/coarseCompositeCache.svelte.ts`
- `app/src/drawing/lod.ts`
- `app/src/drawing/tileStore.svelte.ts`
- `app/src/drawing/types.ts`
- `app/tests/drawing.lod.test.ts`
- `docs/handoff/d43_report_d2.md`
