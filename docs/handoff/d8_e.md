TASK E — debug 8: size rules (Inbox, Source, Dictionary, Map), Map p.11/p.12/p.17, Dictionary p.16

Read C:\hive\docs\handoff\d8common.md and debug 8.md first.
Your files: src/selection/resize.ts, src/selection/groupScale.ts, src/selection/resizeDoubleClick.ts, the resize-handle predicate in src/selection/SelectionLayer.svelte (minimal), src/project/index.ts fixedNodeDimensions (load normalisation), src/map/**, src/spell/DictionaryNodeBody.svelte (sizing/scroll only), tests.

1. Size rules (a small declarative table per kind is welcome):
   - "inbox": width locked; no enlarging; height may only be SHRUNK below its auto height, min 2 rows (worker A supplies row height / auto height via a small exported helper — coordinate via the coordinator); bottom handle only.
   - "glossary" (Dictionary, p.16): not scalable; auto height grows with the words; height may be shrunk only when it has ≥10 words, then a right scrollbar appears; bottom handle only when allowed.
   - "source" (p.13): fixed size (worker D reports the size), no handles.
   - "map" (p.12): now resizable (remove it from the fixed list; keep aspect free; min size sensible).
   Update load normalisation accordingly.
2. Map p.11: Ctrl+mouse wheel while hovering the Map NODE zooms the minimap view (map-internal zoom, persisted per node or view state — say which); plain wheel still zooms the board.
3. Map p.17: draw links on the map (overlay and node): thin lines between node centres in a muted colour, strong vs weak distinguishable; keep it fast (skip when > N links or throttle).
Tests: rule table, shrink limits, map link projection.
