<script lang="ts">
  import { execute } from "../history/history.svelte";
  import { board, updateNote } from "../model/board.svelte";
  import { links } from "../model/links.svelte";
  import type { Note } from "../model/note";
  import { nextDueAt, validateSchedule } from "./scheduler";
  import { projectStopwatch, restartTimeNode, timeCounters } from "./runtime.svelte";
  import TaskLinkStatus from "./TaskLinkStatus.svelte";
  import Select from "../ui/Select.svelte";
  import type { CountMode, StopwatchMode, TimeNodeData, TimeSchedule } from "./types";
  import { copyTimeSchedule, defaultAtTimeSchedule, formatCountdown, intervalHoursHint, timeCheckboxId } from "./uiSchedule";
  import { copyTimeNodeData } from "./data";
  import { activationSourcesForTime } from "./activationLogic";
  import { formatStopwatch, stopwatchElapsedMs, toggleManualStopwatch } from "./stopwatchLogic";

  let { note }: { note: Note } = $props();

  let mode = $state<TimeSchedule["kind"]>("at");
  let atTime = $state("");
  let atDate = $state("");
  let intervalMinutes = $state(1);
  let countMode = $state<CountMode>("calendar");
  let repeat = $state(false);
  let draftEnabled = $state(true);
  let validationError = $state("");
  let scheduleSourceKey = "";
  let now = $state(Date.now());
  const stopwatch = $derived(note.time?.stopwatch ?? {
    mode: "project" as const,
    includeProjectTime: true,
    running: false,
    elapsedMs: 0,
  });
  const stopwatchElapsed = $derived(stopwatchElapsedMs({
    mode: stopwatch.mode,
    noteCreatedAt: note.createdAt,
    projectCreatedAt: projectStopwatch.createdAt,
    counters: { appMs: projectStopwatch.appMs, activeMs: projectStopwatch.activeMs },
    stopwatch,
    now,
  }));
  const stopwatchParts = $derived(formatStopwatch(stopwatchElapsed));
  const activationSources = $derived(activationSourcesForTime(note.id, board.notes, Object.values(links.byId)));

  $effect(() => {
    const persisted = note.time;
    const schedule = persisted?.schedule ?? defaultAtTimeSchedule(note.createdAt ?? Date.now());
    const key = scheduleKey(schedule);
    if (key === scheduleSourceKey) return;
    scheduleSourceKey = key;
    mode = schedule.kind;
    if (schedule.kind === "at") {
      atTime = schedule.time;
      atDate = schedule.date ?? "";
    } else {
      intervalMinutes = schedule.minutes;
      countMode = schedule.mode;
      repeat = schedule.repeat;
    }
    validationError = "";
  });

  $effect(() => {
    draftEnabled = note.time?.enabled ?? true;
  });

  $effect(() => {
    const current = note.time;
    if (!current) return;
    const existing = current.stopwatch;
    const needsAppBase = existing?.nodeCreatedAppMs === undefined;
    const needsActiveBase = existing?.nodeCreatedActiveMs === undefined;
    if (!needsAppBase && !needsActiveBase) return;
    const initialized: TimeNodeData = copyTimeNodeData(current);
    initialized.stopwatch = {
      mode: existing?.mode ?? "project",
      includeProjectTime: existing?.includeProjectTime ?? (existing?.mode === undefined || existing?.mode === "project"),
      running: existing?.running ?? false,
      elapsedMs: existing?.elapsedMs ?? 0,
      ...(existing?.startedAt === undefined ? {} : { startedAt: existing.startedAt }),
      nodeCreatedAppMs: existing?.nodeCreatedAppMs ?? projectStopwatch.appMs,
      nodeCreatedActiveMs: existing?.nodeCreatedActiveMs ?? projectStopwatch.activeMs,
    };
    updateNote(note.id, { time: initialized });
  });

  $effect(() => {
    const timer = window.setInterval(() => { now = Date.now(); }, 1_000);
    return () => window.clearInterval(timer);
  });

  const status = $derived.by(() => {
    const data = note.time;
    if (!data?.enabled) return "Stopped";
    const dueAt = nextDueAt(data, { now, appMs: timeCounters.appMs, activeMs: timeCounters.activeMs });
    if (dueAt === null) return "No next reminder";
    if (data.schedule.kind === "interval") return `Next in ${formatCountdown(dueAt - now)}`;
    return `Next: ${new Date(dueAt).toLocaleString()}`;
  });

  function changeMode(value: string): void {
    if (value === "at" || value === "interval") {
      mode = value;
      validationError = "";
    }
  }

  function currentDraft(): TimeSchedule {
    if (mode === "at") {
      return { kind: "at", time: atTime, date: atDate || null };
    }
    return {
      kind: "interval",
      minutes: intervalMinutes,
      mode: countMode,
      repeat,
    };
  }

  function saveSchedule(): void {
    const schedule = currentDraft();
    const error = validateSchedule(schedule);
    validationError = error ?? "";
    if (error) return;

    const current = board.notes[note.id];
    if (!current || current.type !== "time") return;
    const previous = copyTimeData(current.time) ?? { schedule: copyTimeSchedule(schedule), enabled: false };
    if (scheduleKey(previous.schedule) === scheduleKey(schedule)) return;
    const next: TimeNodeData = { ...previous, schedule: copyTimeSchedule(schedule) };

    execute({
      label: "Change reminder",
      target: current.name,
      do: () => {
        updateNote(note.id, { time: copyTimeData(next)! });
        restartTimeNode(note.id);
      },
      undo: () => {
        updateNote(note.id, { time: copyTimeData(previous)! });
        restartTimeNode(note.id);
      },
    });
  }

  function setEnabled(event: Event): void {
    const enabled = (event.currentTarget as HTMLInputElement).checked;
    draftEnabled = enabled;
    const current = board.notes[note.id];
    if (!current || current.type !== "time") return;
    const previous = copyTimeData(current.time) ?? {
      schedule: defaultAtTimeSchedule(current.createdAt ?? Date.now()),
      enabled: false,
    };
    if (enabled === previous.enabled) return;
    const next: TimeNodeData = { ...previous, enabled };

    execute({
      label: enabled ? "Enable reminder" : "Stop reminder",
      target: current.name,
      do: () => {
        updateNote(note.id, { time: copyTimeData(next)! });
        // Reset on both transitions: disabled nodes have no live countdown, and re-enabling
        // always starts a fresh wait from now rather than catching up missed firings.
        restartTimeNode(note.id);
      },
      undo: () => {
        updateNote(note.id, { time: copyTimeData(previous)! });
        restartTimeNode(note.id);
      },
    });
  }

  function changeStopwatchMode(value: string): void {
    if (!isStopwatchMode(value)) return;
    const current = board.notes[note.id];
    if (current?.type !== "time" || !current.time) return;
    const previous = copyTimeNodeData(current.time);
    const previousStopwatch = previous.stopwatch ?? defaultStopwatch();
    let nextStopwatch = { ...previousStopwatch, mode: value };
    if (previousStopwatch.mode === "manual" && value !== "manual" && previousStopwatch.running) {
      nextStopwatch = toggleManualStopwatch(previousStopwatch, now);
      nextStopwatch.mode = value;
    }
    nextStopwatch.includeProjectTime = value === "project"
      ? true
      : value === "node" || value === "manual"
        ? false
        : previousStopwatch.mode === value ? previousStopwatch.includeProjectTime ?? false : false;
    saveStopwatchChange("Change stopwatch mode", current.name, previous, { ...previous, stopwatch: nextStopwatch });
  }

  function setProjectTimeBase(event: Event): void {
    const includeProjectTime = (event.currentTarget as HTMLInputElement).checked;
    const current = board.notes[note.id];
    if (current?.type !== "time" || !current.time) return;
    const previous = copyTimeNodeData(current.time);
    const currentStopwatch = previous.stopwatch ?? defaultStopwatch();
    if (currentStopwatch.mode !== "active" && currentStopwatch.mode !== "app") return;
    if (Boolean(currentStopwatch.includeProjectTime) === includeProjectTime) return;
    saveStopwatchChange("Change stopwatch start", current.name, previous, {
      ...previous,
      stopwatch: { ...currentStopwatch, includeProjectTime },
    });
  }

  function toggleManual(): void {
    const current = board.notes[note.id];
    if (current?.type !== "time" || !current.time) return;
    const previous = copyTimeNodeData(current.time);
    const currentStopwatch = previous.stopwatch ?? defaultStopwatch();
    if (currentStopwatch.mode !== "manual") return;
    saveStopwatchChange(currentStopwatch.running ? "Stop stopwatch" : "Resume stopwatch", current.name, previous, {
      ...previous,
      stopwatch: toggleManualStopwatch(currentStopwatch, now),
    });
  }

  function saveStopwatchChange(label: string, target: string, previous: TimeNodeData, next: TimeNodeData): void {
    if (JSON.stringify(previous.stopwatch) === JSON.stringify(next.stopwatch)) return;
    execute({
      label,
      target,
      do: () => updateNote(note.id, { time: copyTimeNodeData(next) }),
      undo: () => updateNote(note.id, { time: copyTimeNodeData(previous) }),
    });
  }

  function scheduleKey(schedule: TimeSchedule): string {
    return schedule.kind === "at"
      ? `at|${schedule.date ?? ""}|${schedule.time}`
      : `interval|${schedule.minutes}|${schedule.mode}|${schedule.repeat}`;
  }

  function copyTimeData(data: TimeNodeData | undefined): TimeNodeData | null {
    return data ? copyTimeNodeData(data) : null;
  }

  function defaultStopwatch(): NonNullable<TimeNodeData["stopwatch"]> {
    return {
      mode: "project",
      includeProjectTime: true,
      running: false,
      elapsedMs: 0,
      nodeCreatedAppMs: projectStopwatch.appMs,
      nodeCreatedActiveMs: projectStopwatch.activeMs,
    };
  }

  function isStopwatchMode(value: string): value is StopwatchMode {
    return value === "project" || value === "node" || value === "active" || value === "app" || value === "manual";
  }
</script>

<section class="time-editor" data-time-body data-time-view={note.time?.view ?? "time"} data-time-mode={mode} aria-label="Time node">
  {#if note.time?.view === "stopwatch"}
    <div class="stopwatch-display" role="timer" aria-live="off" data-stopwatch-counter aria-label={`${stopwatchParts.days} days ${stopwatchParts.hours} hours ${stopwatchParts.minutes} minutes ${stopwatchParts.seconds} seconds`}>
      <span>{stopwatchParts.days}<small>d</small></span>
      <span>{stopwatchParts.hours}<small>h</small></span>
      <span>{stopwatchParts.minutes}<small>m</small></span>
      <span>{stopwatchParts.seconds}<small>s</small></span>
    </div>

    <label class="time-field stopwatch-mode-field">
      <span>Mode</span>
      <Select id={`time-${note.id}-stopwatch-mode`} ariaLabel="Stopwatch mode" value={stopwatch.mode} options={[
        { value: "project", label: "Since project created" },
        { value: "node", label: "Since node created" },
        { value: "active", label: "While hive window is focused" },
        { value: "app", label: "While hive runs" },
        { value: "manual", label: "On stop/resume command" },
      ]} onchange={changeStopwatchMode} />
    </label>

    {@const optionalProjectBase = stopwatch.mode === "active" || stopwatch.mode === "app"}
    <label class="time-check stopwatch-project-base" class:optional={optionalProjectBase}>
      <input
        type="checkbox"
        data-stopwatch-project-base
        checked={stopwatch.mode === "project" || optionalProjectBase && stopwatch.includeProjectTime === true}
        disabled={!optionalProjectBase}
        onchange={setProjectTimeBase}
      />
      <span>Since project created</span>
    </label>

    {#if stopwatch.mode === "manual"}
      <button class="stopwatch-toggle" type="button" data-stopwatch-toggle onclick={toggleManual}>
        {stopwatch.running ? "Stop" : "Resume"}
      </button>
      <div class="stopwatch-conditions" data-stopwatch-conditions>
        <span class="conditions-label">Conditions</span>
        <div class="activation-list">
          {#each activationSources as source (source.id)}
            <span class="activation-chip" data-activation-id={source.id}>{source.name}</span>
          {:else}
            <span class="conditions-empty">No activation nodes linked</span>
          {/each}
        </div>
      </div>
    {/if}
  {:else}
  <label class="time-field mode-field">
    <span>Mode</span>
    <Select id={`time-${note.id}-mode`} ariaLabel="Reminder mode" value={mode} options={[
      { value: "at", label: "At time" },
      { value: "interval", label: "Interval" },
    ]} onchange={changeMode} />
  </label>

  {#if mode === "at"}
    <label class="time-field">
      <span>Time</span>
      <input type="time" aria-label="Reminder time" aria-required="true" required bind:value={atTime} />
    </label>
    <label class="time-field">
      <span>Date</span>
      <input type="date" aria-label="Reminder date (optional)" bind:value={atDate} />
    </label>
    {#if !atDate}<p class="time-helper">Every day</p>{/if}
  {:else}
    <label class="time-field">
      <span>Minutes</span>
      <input type="number" aria-label="Interval in minutes" min="1" step="1" required bind:value={intervalMinutes} />
      <small>{intervalHoursHint(intervalMinutes)}</small>
    </label>
    <label class="time-field">
      <span>Count mode</span>
      <Select id={`time-${note.id}-count-mode`} ariaLabel="Interval count mode" value={countMode} options={[
        { value: "calendar", label: "Calendar time" },
        { value: "app", label: "While hive runs (incl. tray)" },
        { value: "active", label: "While hive window is active" },
      ]} onchange={(value) => { if (value === "calendar" || value === "app" || value === "active") countMode = value; }} />
    </label>
    <label class="time-check">
      <input id={timeCheckboxId(note.id, "repeat")} type="checkbox" bind:checked={repeat} />
      <span>Repeat</span>
    </label>
  {/if}

  {#if validationError}
    <p class="time-error" role="alert" data-time-validation>{validationError}</p>
  {/if}

  <div class="time-actions">
    <label class="time-check enabled-check">
      <input id={timeCheckboxId(note.id, "enabled")} type="checkbox" checked={draftEnabled} onchange={setEnabled} />
      <span>Enabled</span>
    </label>
    <button type="button" class="time-save" onclick={saveSchedule}>Save schedule</button>
  </div>
  <p class="time-status" role="status" aria-live="polite" data-time-status>{status}</p>
  {/if}
  <TaskLinkStatus noteId={note.id} />
</section>

<style>
  .time-editor { display: grid; gap: 7px; padding: 8px; color: #d4d4d4; font-size: 10px; }
  .time-field { display: grid; min-width: 0; gap: 3px; color: #aaa; }
  .time-field > span { font-size: 9px; }
  .time-field input {
    box-sizing: border-box; width: 100%; min-width: 0; height: 25px; padding: 0 5px;
    color: #e3e3e3; background: #252727; border: 1px solid #494c4b; border-radius: 3px; font: inherit;
  }
  .time-field input:focus-visible, .time-save:focus-visible, .time-check input:focus-visible { outline: 1px solid #d6ad53; outline-offset: 1px; }
  .time-field small, .time-helper { margin: 0; color: #8b918e; font-size: 9px; }
  .time-check { display: inline-flex; min-height: 22px; align-items: center; gap: 6px; color: #c5c9c7; }
  .time-check input { accent-color: #d2a847; }
  .time-actions { display: flex; align-items: center; justify-content: space-between; gap: 6px; padding-top: 3px; border-top: 1px solid #3c403e; }
  .time-save { min-height: 23px; padding: 2px 7px; color: #dedede; background: #333735; border: 1px solid #505552; border-radius: 3px; font: inherit; cursor: pointer; }
  .time-save:hover { background: #3d423f; }
  .time-status { margin: 0; padding-top: 5px; color: #a2b7a1; border-top: 1px solid #3c403e; font-variant-numeric: tabular-nums; }
  .time-error { margin: 0; color: #e38b83; font-size: 9px; }
  .stopwatch-display {
    display: flex;
    min-height: 42px;
    align-items: baseline;
    justify-content: center;
    gap: 8px;
    padding: 4px 2px 7px;
    color: #f0d58a;
    border-bottom: 1px solid #3c403e;
    font: 700 20px/1 var(--mono-font);
    font-variant-numeric: tabular-nums;
    white-space: nowrap;
  }
  .stopwatch-display small { margin-left: 2px; color: #a4a49a; font: 400 9px var(--ui-font); }
  .stopwatch-mode-field { margin-top: 1px; }
  .stopwatch-project-base { color: #b3b3ae; }
  .stopwatch-project-base input:disabled { opacity: 0.78; }
  .stopwatch-project-base.optional { color: #e0bb63; }
  .stopwatch-project-base.optional input:disabled { opacity: 1; }
  .stopwatch-toggle { justify-self: center; min-width: 82px; min-height: 27px; padding: 3px 14px; color: #e8ddb9; background: #37372f; border: 1px solid #686043; border-radius: 4px; font: inherit; cursor: pointer; }
  .stopwatch-toggle:hover { background: #444234; border-color: #a18a4d; }
  .stopwatch-conditions { display: grid; gap: 4px; }
  .conditions-label { color: #aaa; font-size: 9px; }
  .activation-list { display: flex; min-height: 27px; flex-wrap: wrap; align-items: center; gap: 4px; padding: 4px; background: #232323; border: 1px solid #444; border-radius: 3px; }
  .activation-chip { overflow: hidden; max-width: 100%; padding: 2px 6px; color: #d4d4d4; background: #353535; border: 1px solid #505050; border-radius: 999px; text-overflow: ellipsis; white-space: nowrap; }
  .conditions-empty { color: #777; font-size: 9px; }
</style>
