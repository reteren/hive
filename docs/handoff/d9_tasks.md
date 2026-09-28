Debug after 1.2.4 (28.09). Rules as in C:\hive\docs\handoff\d8common.md (headless Edge blocked for workers; coordinator tests with real mouse; runes only in .svelte/.svelte.ts; don't bump Tauri JS packages; worker_done in Russian once; npm run check + npm test green). The coordinator is personally rewriting Mark as (src/markas/**) — don't touch it.

TASK A (placement + Smooth lines) — files: src/notes/creationPosition.ts (+ callers), src/inbox/** placement, src/links/smoothLines.ts, tests.
1. Random placement gap: change 10–35 u to 5–15 u (both the initial gap and the extra step on conflicts).
2. Smooth lines — the user says it was misunderstood. Correct behaviour: RMB → Smooth lines on node X changes ONLY the attach points ON X (for every link touching X, incoming and outgoing). Never move the anchor on the other node. For each link, X's anchor = the point on X's frame closest to the other end (as today), then:
   A. no two links may attach at the same point on X: minimum distance between attach points 0.75–1 u (use 1 u; spread along the edge, keep order by angle so lines don't cross);
   B. no attach point may sit on a corner: keep at least 1 u away from every corner of X's frame (clamp along the edge).
   One Undo step. Tests: only X's anchors change, min spacing, corner clearance, many links on one edge.

TASK B (List add bug + Tierlist animation) — files: src/list/**, src/tierlist/**, tests.
1. BUG: in a List nothing can be added — "+ Add" opens the picker, but choosing an object does nothing and typing text is impossible (no focus / keystrokes eaten). Find the root cause (focus guard? board hotkeys stealing keys? pointer capture of the picker? outside-click close firing on the picker itself?) and fix; both adding a board object and adding a plain text row must work with real mouse + keyboard. Add a regression test for the cause.
2. Tierlist card dragging: give it the same smooth live animation as List rows (dragged card follows the pointer at 50% opacity, the other cards move apart live to open the slot, animated; reduce-motion respected).

TASK D (Source layout) — files: src/source/**, size rule for source in src/selection/resize.ts + fixedNodeDimensions in src/project/index.ts (height only), tests. Screenshot: C:\Users\reteren\AppData\Local\Temp\orca-paste-1790555407486-ffbc9018-8db3-4293-94a3-ada10d857862.png
1. Source has too much empty space at the bottom: reduce the default height so the content fits snugly (measure; report the new size).
2. Description field: remove the textarea resize grip (the white triangle bottom-right), no scrollbar at all; instead the description grows with its content and the NODE grows in height automatically (auto height). The user still cannot resize Source manually.
