# d42 — performance wave, part 1: audit (common rules)

Goal of the whole wave: hive must stay smooth on a board with **tens of thousands of objects**
(think "half of drive C dropped in": thousands of notes, images, PDFs, videos, thousands of links),
at every zoom from 0.05 to 4, while panning, dragging many objects, typing, and drawing over
huge areas. Today it already stutters at ~220 nodes / ~180 links (user's real project): dragging
anything makes every object move with lag, and drawing over large areas is slow.

This part is a **read-only audit**. Your result is a report; the coordinator turns the reports into
the implementation plan and dispatches the fixes in part 2.

## Rules

- **Do not edit any file in the repository** except your own report
  `C:\hive\docs\handoff\d42_audit_<letter>.md`. No refactors, no "quick fixes".
- Do not run `npm run tauri dev`, the installed hive, or anything that opens a real hive project.
  Never touch `C:\brother eye` or `Documents\hive`.
- You may write throwaway micro-benchmarks (plain node / vitest) **outside the repo**, under
  `%LOCALAPPDATA%\Temp\claude\d42_<letter>\`, and quote their numbers. Say which numbers are
  measured and which are estimated.
- App code: `C:\hive\app\src` (Svelte 5 + TS), Rust in `C:\hive\app\src-tauri\src`.
  1 board unit (u) = 10 px at zoom 1. Camera: `src/board/camera.svelte.ts`, `cameraMath.ts`.

## What to look for (in your area)

1. Work that is **O(all objects)** per pointer move / per frame / per keystroke / per camera change
   (loops over `board.notes`, `Object.values(...)`, whole-board serialisation, reactive `$derived`
   that depends on the whole board, `$effect` that reruns for every node when one node moves).
2. Svelte 5 reactivity traps: one deep `$state` object whose mutation invalidates every reader;
   components that re-render for all nodes when one changes; `{#each}` without keys.
3. Layout thrash: `getBoundingClientRect`/`offsetHeight` reads mixed with writes, ResizeObserver
   storms, forced layouts per event (see vault knowledge: getBoundingClientRect in pointermove).
4. Things that are rendered or alive while **off-screen** or **too small to see** (DOM nodes,
   CodeMirror instances, images at full resolution, GIF/video/iframe playing, SVG paths, glow/blur
   box-shadows, animated gradients, filters).
5. Missing level-of-detail at far zoom (text/markdown rendered when a node is 3 px tall, etc.).
6. Memory: full-resolution image decode, caches that never shrink, listeners never removed.

## Report format (`d42_audit_<letter>.md`, English, ≤ 250 lines)

1. **Hot paths** — a ranked table: `#`, what happens, where (`file:line`), complexity per event
   (e.g. O(nodes) per pointermove), why it hurts, measured/estimated cost at 10 000 nodes.
2. **Proposed fixes** — for each hot path: the concrete change (data structure, culling rule,
   caching, LOD rule), which files it touches, risk (what may break), expected gain.
3. **Culling / LOD contract** — what your subsystem needs from a shared "visible set" / "zoom level
   of detail" service if the coordinator builds one (inputs, outputs, update frequency).
4. **Quick wins** (≤ 30 lines of change each) vs **structural changes** — two separate lists.
5. Open questions.

Finish with `worker_done` (outcome succeeded), `--files-modified` = your report path, and a
3-sentence body naming your top 3 findings.
