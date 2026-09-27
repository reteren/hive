TASK F — R7.6 Map overlay + Map node

Read C:\hive\docs\handoff\r7common.md first.
Your files: new src/map/** (map rendering from board data, MapOverlay.svelte mounted once — append its mount in src/App.svelte or Board.svelte with a minimal diff, MapNodeBody.svelte, commands, init), tests.

1. Map rendering (shared by overlay and node): whole-board bounds (notes, zones, beacons, ME) fitted into the map box with padding; zones as their shapes in their colours (translucent), notes as small rectangles (kind tint), beacons as dots in their colours, links optional (thin, only if cheap), current camera viewport as an outlined rectangle. Use a <canvas> or SVG; must stay fast for 300 notes / 50 zones (throttle redraws to rAF, recompute bounds only on board version change).
2. Overlay: a free key (check src/commands for conflicts; propose e.g. "Shift+M" or "Ctrl+M" is taken → choose and report) and F3 "Open map" toggle a large centred panel (~70% of the window) over the board; click or drag inside moves the camera centre to that board point (live while dragging); wheel over the map zooms the camera; Esc / the key / click outside closes. Opening never creates a node.
3. Map node (kind "map"): a small fixed-size minimap on the board (like Trash/Archive: fixed size, no resize handles — coordinate with the fixed-size list in src/selection/resize.ts via the coordinator), same click-to-jump.
Tests: bounds fitting math, map↔world coordinate conversion, viewport rectangle.
