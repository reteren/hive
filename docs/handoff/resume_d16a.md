RESUME — TASK A of the 1.1.6 debug wave (zone tool fixes and zone moving), browser port 1431.

The previous worker was interrupted by a PC shutdown. Its unfinished work is committed as a checkpoint: git commit ec06e44 "WIP checkpoint after shutdown" (files: src/zones/zoneMode.ts, zoneMode.svelte.ts, ZoneBrushLayer.svelte, brushStroke.svelte.ts, BrushPanel.svelte, ZonesLayer.svelte, zoneGestures.ts, src/selection/SelectionLayer.svelte). npm run check and npm test are green at that checkpoint.

Read C:\hive\docs\handoff\d16common.md and C:\hive\docs\handoff\d16_a.md (the full task), then `git show ec06e44` to see what exists. Compare with every point of d16_a.md, finish what is missing, fix what is wrong, and verify each point (tests + a real-mouse CDP smoke like docs/handoff/zbsmoke.mjs). Known gaps to check first: the RMB zone menu item "Move zone" (not found in ZonesLayer yet), G over a zone in the zone tool, Ctrl carrying member nodes, Enter/RMB/tool switch finishing, Esc cancelling, removal of the old select-tool zone drag, brush cursor hidden outside the zone tool and in move mode.
Files you own: same as d16_a.md. Worker D's anchoring/outside-close code in the zone menu is final — keep it.
Rules as in d16common.md. worker_done in Russian, once.
