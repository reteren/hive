TASK B — R7.1–R7.2 board side: Inbox node, placement, twins

Read C:\hive\docs\handoff\r7common.md first.
Your files: new src/inbox/** (InboxNodeBody.svelte, inbox logic, event listener for "hive://quick-input", twin resolution), tests. Hooks into selection/editing/move for "first interaction" — ask the coordinator for the exact seam (likely a small listener API on selection changes and editing start rather than editing SelectionLayer).
Worker A builds the tray/shortcut/quick window and the event contract: quick window emits "hive://quick-input" {text, requestId}; you reply "hive://quick-input-result" {requestId, ok, error?: "no-inbox"}. Also expose a function submitQuickInput(text): result so it can be tested and used from an in-app F3 command "Quick input to Inbox" (opens a small in-app prompt) for testing without the OS window.

1. Inbox node (kind "inbox"): shows a title and a count of linked entries ("12 entries") and the latest 3 entry names; click an entry name → jump to it.
2. On input: if no Inbox nodes → error "no-inbox". One Inbox → create a note (name from the first line, trimmed to ~40 chars, unique; text = full input) placed next to the Inbox using the non-overlapping placement helper (creationPosition), strong link Inbox → note. One Undo step.
3. Several Inbox nodes → create one twin note next to EACH Inbox, all with the same inboxGroup id and the same text, each linked from its Inbox. The first real interaction with a twin (it becomes selected by click, enters editing, or is moved; NOT hover, NOT marquee-touching? → marquee selecting counts as selection: say what you decided) resolves the group: that twin stays (inboxGroup cleared), the others are removed. The resolution is one Undo step (undo restores all twins). Twins are visually marked (subtle dashed outline + tooltip "Twin of an Inbox entry — interact to keep this one").
4. Persisted: twins survive reload (inboxGroup persisted).
Tests: placement, error, twins creation and resolution, undo.
