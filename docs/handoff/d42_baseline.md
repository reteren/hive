# d42 baseline measurements (coordinator, 12.10.2026, dev build, isolated instance)

Bench: `bench.mjs` over CDP with real mouse events — rAF frame intervals (monitor 180 Hz → 5.6 ms idle).
Projects: copy of the user's real project (224 nodes: 177 notes, 15 images, 11 beacons, 7 progress,
1 map; 179 links, 9 zones, drawing) and synthetic `big3k` (2700 notes + 300 images 1600×1200, 2500 links).

| project | zoom | drag 1 node (median / p95) | drag group | wheel p95 / max | open |
|---|---|---|---|---|---|
| real copy | 1 | 5.6 / 5.6 (node off-screen, not a real drag) | — | 11 / 117 | 0.96 s |
| real copy | 0.4 | **94 / 139 ms** | 5.6 (14 nodes) | 5.7 / 17 | |
| real copy | 0.15 | **89 / 144 ms** | **94 / 111 ms** (28 nodes) | 28 / 695 | |
| big3k | 1 | **56 / 67 ms** | 39 / 45 | 195 / 434 | **39.8 s** |
| big3k | 0.1 | **45 / 56 ms** | 100 / 117 | **2284 / 5424** | |

Top self time while dragging:
- real copy: `summarizeProgress` (progress/progress.ts) 6.1 s of 22 s — the 7 Progress nodes recompute
  their whole scope on every pointermove; Svelte proxy `get` 3.2 s; zones `clipToRect`/`shapeAreaInRect`.
- big3k: `listStatisticsWidth` (stats/listStatsLayout.ts) 2.5 s, `recomputeZoneMembership` 2.4 s,
  LinksLayer (anon :86, smoothPath, sameLinkRenderInputs) ~2.8 s, `noteBounds` 0.9 s, Svelte
  `reset_all`/`get`/`strict_equals` (reactivity fan-out) ~10 s.
