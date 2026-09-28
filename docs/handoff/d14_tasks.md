R8, delivery 1 (R8.1–R8.6): Time and Message without heavy automation. Read ROADMAP.md section R8 first. Rules as in C:\hive\docs\handoff\d8common.md (headless Edge blocked for workers; coordinator tests with real mouse; runes only in .svelte/.svelte.ts; don't bump Tauri JS packages; worker_done in Russian once — verify the send returned ok; npm run check + npm test green). Stay in your files; ask when unsure.

Shared contract (already committed, coordinator-owned): app/src/time/types.ts (CountMode, TimeSchedule, TimeRuntime, TimeNodeData, MessageNodeData, ShownMessage) and Note fields `time?: TimeNodeData`, `message?: MessageNodeData`, kinds "time" | "message" (R8_KINDS), base width 30 u each. Do not change them — ask.

User decisions (28.09):
- A message is a card in the top-right that stays until closed (× or "Go to"); several cards stack; sound and auto-hide are per Message node settings (defaults: sound off, autoHideSeconds null).
- Default count mode for a new interval: calendar time. All three modes exist and the mode is visible before starting.
- Task with a Time restored from the archive: ASK "Resume reminder?"; never replay missed repeats.
- Time → Message needs no Task/Action/IF: a strong link Time → Message makes the Message fire when the Time is due. A Time without any Message shows its own name/label as the card text.

Agreed APIs (implement exactly these names so parallel work fits):
- src/time/scheduler.ts (TASK TA, pure TS, no runes):
  `validateSchedule(s: TimeSchedule): string | null` — error text or null (time required; "YYYY-MM-DD" date optional; minutes ≥ 1).
  `startRuntime(s: TimeSchedule, ctx: TimeContext): TimeRuntime` — fresh runtime when a schedule is created/edited or re-enabled (editing cancels the old waiting, R8.1).
  `evaluateTime(data: TimeNodeData, ctx: TimeContext): { fire: TimeFire | null; runtime: TimeRuntime }` — called every tick; returns at most ONE fire per call.
  `nextDueAt(data: TimeNodeData, ctx: TimeContext): number | null` — wall-clock ms estimate of the next firing (for UI countdown; for app/active modes = now + remaining counted ms).
  `interface TimeContext { now: number; appMs: number; activeMs: number }` (appMs/activeMs = monotonic totals from the runtime, persisted across restarts).
  `interface TimeFire { key: string; dueAt: number; overlate: boolean }` — key is stable per occurrence (e.g. `${date}T${time}` or `interval:${n}`) for the R8.6 duplicate guard.
- src/messages/messageQueue.svelte.ts (TASK TC): `messageQueue` ($state { items: ShownMessage[] }), `pushMessage(m: Omit<ShownMessage, "id" | "shownAt">): string`, `dismissMessage(id: string): void`.
- src/time/runtime.svelte.ts (TASK TD): `timeCounters` ($state { appMs: number; activeMs: number }), `startTimeRuntime(): () => void` (called once from the main window init), `restartTimeNode(noteId: string): void` (used by the Time UI on edit/enable).

TASK TA (scheduler core) — files: src/time/scheduler.ts, tests/time.scheduler.test.ts only. Pure functions per the API above:
1. "at" with date: one firing at local date+time; after it fired (lastFiredKey) never again. "at" without date: every day at that local time.
2. "interval": minutes counted in the chosen mode — calendar: wall-clock since intervalStartedAt; app: appMs delta; active: activeMs delta (runtime stores the counter value at start in countedMs). repeat → next occurrence starts from the firing moment; no repeat → fires once.
3. R8.6 missed occurrences: if several occurrences were missed (sleep, app closed, clock jump), return only the LAST missed one with overlate: true, and never an occurrence whose key equals lastFiredKey. Clock changes (now < lastCheckedAt, or a forward jump) must not produce duplicates of an already shown occurrence and must not produce a flood.
4. Local-time correctness incl. DST days, month ends (use local Date arithmetic, not 24h*ms for daily).
Many unit tests (daily across midnight, one-shot in the past on creation = no fire? → decide: a one-shot whose moment is already past at creation does NOT fire; document it), sleep over several daily occurrences → one overlate, repeated intervals, app/active modes.

TASK TB (Time node UI) — files: src/time/TimeNodeBody.svelte (+ small .ts helpers in src/time/ui*), node registration (registerNodeBody), create-menu entry (Q menu, next to R7 kinds), size rule (fixed width 30 u, auto height; FIXED-like: no user resize except Shift-scale), serializers for `time` in src/archive, src/trash, src/project (+ tests).
Body: mode switch "At time" / "Interval". At time: time input (required) + optional date (clear = daily, show "Every day" when empty), cannot save a date without a time (validateSchedule message inline). Interval: minutes (and hours helper), count mode select with the three modes named clearly ("Calendar time", "While hive runs (incl. tray)", "While hive window is active") shown BEFORE starting, repeat checkbox. Enable switch. Status line: next due (date/time or countdown using nextDueAt + timeCounters), "Stopped" when disabled. Editing the schedule or enabling calls restartTimeNode(id) (stub-import from src/time/runtime.svelte.ts; TD implements it). All edits one Undo step each. New node defaults: at-time now+1h rounded to 5 min, no date, enabled.

TASK TC (Message node + message cards) — files: src/messages/** (MessageNodeBody.svelte, messageQueue.svelte.ts, MessageCards.svelte mounted once in the main window, sound helper), registration + create-menu entry, size rule (fixed width 30 u, auto height), serializers for `message` in archive/trash/project, tests.
Message node body: the text (the note's text, multiline), "Sound" checkbox, "Hide after [ ] s" (empty = stays until closed). Cards: top-right, below the top-right toolbar panels (must not cover Search/Undo log/Tasks/Objects/Trash buttons), newest on top, max ~4 visible then "+N more", each shows text (preview of the Message node text, clamp 4 lines), time due (and "late" badge when overlate), × close, "Go to" → camera flies to the Message node (or the Time node if messageId is null) and selects it — but if the user is typing (focus in a text field / editor), "Go to" does NOT steal focus or selection until they click it explicitly; never navigate automatically. Sound: short soft WebAudio tone, respects a global mute if one exists. Auto-hide per card. Reduce-motion respected.

TASK TD (runtime service) — files: src/time/runtime.svelte.ts, src/time/init.ts (wire into the main window init; not in the quick-input window), tests; may add a tiny Tauri command in src-tauri/src/lib.rs ONLY if needed for app-running time while the window is hidden (prefer JS wall-clock deltas).
1. Tick every 1 s (setInterval + wall-clock deltas, robust to throttling of the hidden/tray webview: large gaps count fully for "app" mode while the process lives; "active" counts only while the hive main window is focused — use Tauri window focus events + document.hasFocus()).
2. Persist appMs/activeMs totals (project-level or app-level settings — pick app-level via the settings persistence used for view settings, report the choice) so modes survive restart; app mode does NOT count while hive is closed.
3. For every enabled Time node: evaluateTime → on fire: write runtime back WITHOUT creating Undo history (mark project dirty for autosave), find strong links Time → Message (both directions? only Time as `from`) and pushMessage for each Message node (text = message note text, sound/autoHide from its MessageNodeData); if none, push a card with the Time node's name. Also write runtime periodically (lastCheckedAt) without history.
4. restartTimeNode(id): runtime = startRuntime(schedule, ctx) without history (the UI's own Undo step covers the schedule edit).
5. Startup/resume: first tick after launch or after a long gap applies TA's missed rule (one overlate card). Deleting/trashing a Time node stops it; restoring from trash resumes per its enabled flag.

TASK TE (Task → Time, R8.4) — files: src/time/taskLink*.ts (+ .svelte.ts if runes), hooks in src/tasks/** completion/archive paths (small isolated calls), archive restore prompt (src/archive/** UI part), tests.
1. A strong link Task → Time makes the Task the completion source of that Time; a task can have several Times. Completing the task or archiving it disables every linked Time (enabled=false) — no more messages from the old waiting. A plain Time without a task keeps working.
2. Per-Time "After task completion" option (show in the Time node only when a task is linked; coordinate with TB via a small exported component or a field TB renders — add optional `taskMode?: "stop" | "restart"` ONLY via the coordinator: ask first) — for now implement "stop" only and report what "restart" would need.
3. Restoring the task from the archive → prompt "Resume reminder?" (Yes = enabled + restartTimeNode, no missed repeats; No = stays off).
4. Copying a task that has an active Time (M209): the copy's linked Times are copied active; show a short notice "Reminder copied with the task".
Tests for each.
