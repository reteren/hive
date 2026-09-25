TASK B — zone brush input, preview and commit (browser port 1432)

Read C:\hive\docs\handoff\zbcommon.md first.
Your files: src/zones/ZonesLayer.svelte (zone-tool input part), new src/zones/ZoneBrushLayer.svelte (brush cursor + live stroke preview overlay; mount it yourself in src/board/Board.svelte right after <ZonesLayer />, minimal diff), new src/zones/brushStroke.svelte.ts (stroke state + commit), tests.
Depends on worker A's src/zones/brush.ts (use only its exported functions) and worker C's brushState.size.

1. In the zone tool: show the brush square outline under the cursor (size = brushState.size, snapped like brushSquare). LMB drag paints, RMB drag erases (no context menu in zone tool), live preview of the accumulated stroke (paint = zone-like fill in the target zone colour or a neutral new-zone colour; erase = hatched/red-ish overlay). Release → commit: paintStroke / eraseStroke → ONE history command ("Paint zone" / "Erase zone"), new zone gets the next default name and palette colour as zone creation does today. Esc during a stroke cancels it.
2. Ctrl+LMB drag → rectangle (snapped to 10 u) paint; Ctrl+RMB drag → rectangle erase; same commit rules; the rectangle preview replaces the brush preview while Ctrl-dragging.
3. Ctrl + wheel in the zone tool changes the brush size one step per notch (call C's setter; ask C/coordinator for its name) instead of zooming; plain wheel still zooms/pans as today.
4. Start rule: pointer down inside a zone → extend that zone; on empty board → new zone. Clicks on notes/links while the zone tool is active behave as today (don't break selection in other tools).
5. Keep crisp rendering; preview must stay smooth on long strokes (throttle to rAF).
Tests for the pure parts of brushStroke (start-target resolution, commit command do/undo).
