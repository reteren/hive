# d43 — performance wave, part 2: fixes (common rules)

Read first: `d42common.md` (goal), `d42_baseline.md` (measured numbers), and the audit report for your
area (`d42_audit_<x>.md`). Your task is in `d43_tasks.md`. This part **changes code**.

## Measured facts that drive priorities

- User's real project (224 nodes, 7 Progress, 9 zones) at zoom 0.15–0.4: dragging ONE node runs at
  ~90 ms per frame. Top cost: `summarizeProgress` re-running for every Progress node on every
  pointermove (6.1 s of 22 s), then Svelte proxy reads and zone `clipToRect`/`shapeAreaInRect`.
- Synthetic 3000 nodes: drag 45–56 ms/frame; wheel zoom stalls up to 5.4 s; project open 39.8 s.
  Hot: `listStatisticsWidth` (called O(N) per move through `noteBounds`), `recomputeZoneMembership`,
  LinksLayer derivation, `makeSnapshot` (measured 65–94 ms at 10k by audit e).

**Rule of the wave: nothing may do O(all nodes) or O(all links) work per pointermove, per frame,
per keystroke or per camera change.** O(changed objects), O(visible objects) or O(degree) only.
Full passes are allowed on project open, explicit export, debounced save of *changed* data, and idle.

## Shared contracts (do not reimplement; ask if you need more)

1. **Board mutations** — `src/model/board.svelte.ts` now exports
   `onBoardMutation(listener: (ids: readonly string[] | null) => void): () => void` and
   `notifyBoardMutation(ids | null)`. `addNote`/`removeNote`/`updateNote` emit the changed id,
   `replaceBoard` emits `null` (= everything). If you find code that writes note fields directly
   (not through `updateNote`) on a note that is already on the board, route it through `updateNote`
   or call `notifyBoardMutation([id])` after it. Listeners must be cheap (record ids, work later).
2. **Links adjacency** — owned by agent **b**: `linksOf(noteId)` in `src/model/links.svelte.ts` becomes
   O(degree) (adjacency map kept in sync with every link mutation). Everyone else: use `linksOf`
   instead of `Object.values(links.byId).filter(...)`; never scan all links per node.
3. **Visibility / LOD / spatial index** — owned by the **coordinator**, file
   `src/board/visibility.svelte.ts` (lands during this wave; until then code against this API):
   - `lod.tier: "full" | "simple" | "min"` — reactive; `full` at zoom ≳ 0.35, `simple` ≳ 0.12, else `min`.
   - `visible.ids: ReadonlySet<string>` — reactive (the Set object is replaced when membership
     changes): notes intersecting the viewport + margin, plus pinned notes.
   - `visible.rect: Bounds` — reactive world rectangle currently considered visible (with margin).
   - `queryRect(rect: Bounds): string[]` and `queryPoint(p: Point): string[]` — non-reactive spatial
     queries over ALL notes (not only visible), unordered; callers sort by `orderIndex` if needed.
   - `pinNote(id: string, reason: string): () => void` — keep a note mounted/visible (playing
     media, recording, active timer UI); call the returned function to unpin.
   Culled notes are **unmounted** by the coordinator's NotesLayer, and in `simple`/`min` tiers visible
   notes are drawn as light shells without their body component, so per-node
   components must not assume they stay alive, and nothing semantic (timers, reminders, saving,
   statistics) may live only inside a node body component.
4. Model geometry (`noteBounds`, `measuredHeights`) stays valid for unmounted notes (coordinator
   keeps last measured heights).

## Rules

- Touch only the files your task lists as yours. Need a change in someone else's file → `ask` the
  coordinator; do not edit it.
- Keep behaviour identical unless the task says otherwise. Performance only.
- Add/extend vitest tests for the new data structures (indexes, caches, dirty tracking). Rust: `cargo test`.
- Before `worker_done`: `npm run check` (0 errors) and `npm test` in `C:\hive\app` must pass; Rust
  changes also `cargo test` in `src-tauri`. Run `cargo` with `CARGO_TARGET_DIR=target-b` so you do
  not fight the coordinator's dev build.
- Do not run `npm run tauri dev`, do not open real projects, do not commit (the coordinator commits).
- Where you can, measure before/after with a throwaway micro-benchmark under
  `%LOCALAPPDATA%\Temp\claude\d43_<letter>\` and put the numbers in your report.
- Report: write `C:\hive\docs\handoff\d43_report_<letter>.md` (what changed, files, numbers,
  anything left), then `worker_done` with `--files-modified` listing every file you changed.
