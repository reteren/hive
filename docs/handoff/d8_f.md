TASK F — improvement 1: "Mark as" custom tag module

Read C:\hive\docs\handoff\d8common.md and debug 8.md (improvement 1) first.
Your files: new src/markas/** (body, tag editor, frame rendering, actions, init), module insert/pull-out integration in src/modules/** (reuse the Mood/Purpose mechanics — ask the coordinator if you need a seam in shared files), the note frame rendering hook for the coloured/gradient frame (NoteNode.svelte — minimal: e.g. a data attribute + CSS variables; ask first), tests.

1. Mark as node (kind "markas", small, not resizable — size follows content like Mood; tell worker E via the coordinator to treat "markas" as fixed/auto-size): holds several user tags (customMarks: text ≤ 30 chars, colour from a palette + custom hex). "+" adds a tag (inline text input + colour swatch), click a tag to edit, × to delete. A "Frame" checkbox (customMarkFrame).
2. Insert into a note: drag the Mark-as node onto a note (like Mood) → the note gets the tags (customMarks merged, no duplicates by text+colour) and the frame flag; shown as chips in the note's module rows (after Importance/Purpose/Mood). Pull a chip out → creates a Mark-as node linked like the other modules. Merge Mark-as onto Mark-as merges tags. One Undo step each.
3. Frame: when the note (or the Mark-as node itself) has customMarkFrame and tags, its frame is coloured with the tag colour; several tags → an animated gradient cycling through exactly those colours (like Importance absolute), reduce-motion → static gradient. Must stay crisp and not fight the Importance frame (say which wins when both are present).
4. Mark as applies to linked notes like other external modules (strong link from Mark-as to a note applies its tags) — reuse effective* patterns.
Tests: tag validation (30 chars, colour), merge rules, insert/pull-out undo, effective marks.
