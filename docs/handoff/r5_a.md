TASK A — R5.1 Goal (browser port 1431)

Read C:\hive\docs\handoff\r5common.md first.
Your files: new src/goal/** (goal.ts logic, GoalBody.svelte, init), src/tasks/** only if a minimal hook is needed (ask first), tests app/tests/goal*.test.ts. Register your body via nodeBodies.

- Goal node: name + short text allowed (keep it simple: a title and a one-line description field or the normal header only — choose and explain), plus a list/count of directly connected tasks "3 / 4 done".
- Connected tasks = task notes with a STRONG link INTO the goal. Weak links don't count.
- Gold: all connected tasks done and at least one → gold glow on the node (animated shimmer respecting data-reduce-motion; crisp). Otherwise normal. Updates live (task toggles, new links, link removal, task flag removal, Undo).
- Goal itself has no checkbox; it can't be marked as a task (hide "Mark as task" for goal in the note menu — noteMenu.ts has a visibility predicate API; ask if you need to edit another owner's item).
- Goal may link onward (goal → something) normally.
- Pure function goalState(goalId) → {connected, done, gold}; tests: A→B→Goal counts only B; undo/redo; weak link ignored; zero tasks = not gold.
