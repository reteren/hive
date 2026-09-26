TASK B — scope picker + R5.2 Progress + R5.9 Statistics (browser port 1432)

Read C:\hive\docs\handoff\r5common.md first.
Your files: new src/scope/** (scope resolution + ScopePicker.svelte), new src/progress/**, new src/stats/**, tests. Register bodies via nodeBodies.

1. Scope: resolveScope(scope) → set of note ids in scope: Board = all notes; zone = zoneMembers(id); beacon = the beacon's network exactly as beacon focus computes it (src/beacons/coverage.ts). Missing zone/beacon (deleted) → shows "Scope missing" and counts nothing (don't crash; let the user pick again). ScopePicker: compact dropdown in the node header/body listing Board, zones by name, beacons by name (ME included). Changing scope = one Undo step, stored in note.scope. Default on creation: the zone the node stands in, else Board (set it when the node is created — hook: a small effect on first render if scope is undefined is NOT allowed to create an Undo step; better: compute default lazily when scope is undefined and store only when the user picks).
2. Progress: only task notes in scope; weight 1 (no Importance) or 1..5 by effectiveImportance level; shows a bar, "done/total" weight and %; empty → "—". Live updates. Tests: two equal tasks, one done = 50%; weights; empty scope; task in two paths counted once.
3. Statistics: words, characters, lines of all text notes in scope (note/pro/con/task text; not beacons/modules; calculators/tierlists excluded — say what you chose), each note counted once; live. Tests.
