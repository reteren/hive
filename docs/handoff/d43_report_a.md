# d43 task A — per-node derived computation report

## Changes

- Added per-scope Progress and text Statistics revision caches. Board and zone summaries invalidate for task state, task importance, text, and relevant scope membership changes; x/y-only note updates do not change those revisions. Beacon summaries also track descendant membership and semantic revisions for their members. Progress and Statistics nodes sharing a scope reuse one aggregate.
- Progress importance revisions account for linked Importance modules. The scope and styling paths use `linksOf`; module and Mark as display helpers memoize per note, and per-note link revisions keep their reactive results current.
- List Statistics reads incident links for linked rows. Width helpers return immediately for non-List notes and perform constant-time measurement lookups for Lists.
- Message and Time lookups use incident links and inspect only linked candidates while preserving board order. Time bodies share the runtime clock; the scheduler maintains an enabled-Time index from board mutations and ticks only those ids.
- Map nodes share one frame snapshot. Geometry and structural changes invalidate the snapshot, camera-only changes update the viewport over cached geometry, and the frame gate permits at most one rebuild per animation frame. The whole-board JSON geometry key was removed.

## Measurement

A one-off Vitest microbenchmark used a synthetic 224-note board with 217 tasks, 7 Progress nodes, 9 zone ids, and 400 movement frames. Recomputing all seven summaries each frame took 27.98 ms; the shared cached path took 1.60 ms in the same process. This measures summary work only, not end-to-end UI frame time; the throwaway benchmark was removed and its result is saved at `%LOCALAPPDATA%\Temp\claude\d43_a\results.md`.

## Verification

- Targeted regression tests: 37 passed across Progress caching, scope revisions, links, list statistics, message resolution, Time lookup/indexing, and the map frame gate. This run completed before the concurrent zone-membership source was removed from the shared workspace.
- Latest full `npm test`: 200 passed and 8 tests failed (1,380 total); 11 additional suites failed to load because `app/src/zones/membership.svelte.ts` is currently absent during the parallel zone refactor. The 8 failing tests are in non-A areas: `dependencies`, `imageAlpha`, `tierlist.audioPlayback`, and `time.completion`.
- Latest `npm run check`: 19 errors across 16 files. Most report the missing zone-membership module imported across the app; the remaining 3 are in non-owned `src/tasks/taskActions.svelte.ts` (`taskLog` is undefined and the `reduce` parameters become implicit `any`). No diagnostics were reported in task A's changed files.

## Files changed by task A

`app/src/progress/ProgressBody.svelte`, `app/src/progress/progressCache.svelte.ts`, `app/src/scope/scope.svelte.ts`, `app/src/scope/scopeRevision.svelte.ts`, `app/src/scope/revisionCache.ts`, `app/src/stats/StatisticsBody.svelte`, `app/src/stats/statisticsCache.svelte.ts`, `app/src/stats/listStatistics.ts`, `app/src/stats/listStatsLayout.ts`, `app/src/stats/linkedList.svelte.ts`, `app/src/stats/linkedTierlist.svelte.ts`, `app/src/stats/listStatsPullOut.ts`, `app/src/modules/moduleActions.svelte.ts`, `app/src/messages/resolution.ts`, `app/src/messages/MessageNodeBody.svelte`, `app/src/time/TimeNodeBody.svelte`, `app/src/time/runtime.svelte.ts`, `app/src/time/actions.svelte.ts`, `app/src/time/activation.svelte.ts`, `app/src/time/taskLink.ts`, `app/src/time/scheduleIndex.ts`, `app/src/map/MapView.svelte`, `app/src/map/mapFrame.svelte.ts`, `app/src/map/frameSnapshotGate.ts`, `app/tests/progress.cache.test.ts`, `app/tests/scope.revisionCache.test.ts`, `app/tests/time.scheduleIndex.test.ts`, `app/tests/map.frameSnapshotGate.test.ts`.
