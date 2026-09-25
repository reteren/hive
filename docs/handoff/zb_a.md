TASK A — zone brush engine (browser port 1431). DELIVER FIRST: B depends on it.

Read C:\hive\docs\handoff\zbcommon.md first.
Your files: src/zones/brush.ts (replace the `declare` stubs, keep signatures), src/zones/shape.ts + src/zones/shapeGrid.ts (additions only, keep existing API), tests app/tests/zoneBrush*.test.ts.

Implement brush.ts:
- normalizeBrushSize: nearest multiple of 20, clamped 20..300 (NaN → BRUSH_MIN).
- brushSquare: square of `size` centred on the point, its top-left snapped to the 10 u grid (document the exact rounding).
- brushSegmentShape: union of squares stamped along from→to at ≤ half-grid spacing so there are no gaps even for long fast moves; orthogonal result.
- unionShapes / subtractShapes (reuse the coordinate-compression grid; subtract then prune pieces thinner than ZONE_MIN_THICKNESS).
- paintStroke: target zone grows (union), new zone otherwise; clip against every other zone; prune thin; return null shape if nothing remains (e.g. stroke fully inside other zones).
- eraseStroke: subtract from every zone, report changed and removed zones.
Performance: a long stroke with a 20 u brush over 2000 u must stay fast — the UI calls brushSegmentShape per pointermove and unionShapes to accumulate; aim < 2 ms per move for typical shapes (benchmark in a test with a generous bound, e.g. < 50 ms for 200 moves). If union per move is too slow, add a helper for accumulating cells and tell the coordinator the extra API.
Tests: snapping, size normalization, gap-free fast segment, paint into zone, new zone, clipping against neighbour, erase splitting a zone into two parts (one zone), erase removing a zone, thin leftover pruning at 20 u.
As soon as the public functions work, `orca orchestration send` the coordinator a short status so B can start; then finish with worker_done.
