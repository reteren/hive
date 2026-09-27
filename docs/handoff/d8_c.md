TASK C — debug 8: p.6 Statistics with List (linked and inserted)

Read C:\hive\docs\handoff\d8common.md and debug 8.md (p.6) first.
Your files: src/stats/**, src/list/ListBody.svelte ONLY for the inserted-extension slot (worker B edits src/list for dragging/icons — coordinate via the coordinator; prefer a small <ListStatsExtension note={...}/> component you own that B mounts, or ask the coordinator for the exact seam), module insert/pull-out hooks in src/modules/** (reuse the Mood/Purpose insert mechanics), tests.

1. Statistics linked to a List (strong link Statistics → List, like the Tierlist/beacon link lock): Statistics turns into a vertical per-row view in list order. Each line: "<name> · words - 74 · characters - 546 · lines - 3" for notes; beacons "<name> · connections - 5"; text rows use the row text (words/characters); zones and missing targets "—". Labels written out ("words - 74"). The node grows by itself with the number of rows (auto height), locked picker label "Linked to <List>".
2. Insert Statistics INTO a List (drag the Statistics node onto the List, like inserting Mood into a note): sets note.listStats = true on the List and removes the Statistics node (one Undo step); the List shows a stats column on the right of each row WITHOUT the name ("words - 74 · characters - 546 · lines - 3" / "connections - 5"). Pulling it out (drag the column/chip out, like modules) recreates a Statistics node linked to the List and clears listStats.
3. Live updates on text/row/link changes; memoized.
Tests: per-kind stats, connections count, insert/pull-out undo.
