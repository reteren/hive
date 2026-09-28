<script lang="ts">
  import { execute } from "../history/history.svelte";
  import { board, updateNote } from "../model/board.svelte";
  import type { Note } from "../model/note";
  import { nextDueAt, validateSchedule } from "./scheduler";
  import { restartTimeNode, timeCounters } from "./runtime.svelte";
  import TaskLinkStatus from "./TaskLinkStatus.svelte";
  import type { CountMode, TimeNodeData, TimeSchedule } from "./types";
  import { copyTimeSchedule, defaultAtTimeSchedule, formatCountdown, intervalHoursHint } from "./uiSchedule";

  let { note }: { note: Note } = $props();

  let mode = $state<TimeSchedule["kind"]>("at");
  let atTime = $state("");
  let atDate = $state("");
  let intervalMinutes = $state(1);
  let countMode = $state<CountMode>("calendar");
  let repeat = $state(false);
  let draftEnabled = $state(true);
  let validationError = $state("");
  let sourceKey = "";
  let now = $state(Date.now());

  $effect(() => {
    const persisted = note.time;
    const schedule = persisted?.schedule ?? defaultAtTimeSchedule(note.createdAt ?? Date.now());
    const key = `${scheduleKey(schedule)}|${persisted?.enabled ?? true}`;
    if (key === sourceKey) return;
    sourceKey = key;
    mode = schedule.kind;
    if (schedule.kind === "at") {
      atTime = schedule.time;
      atDate = schedule.date ?? "";
    } else {
      intervalMinutes = schedule.minutes;
      countMode = schedule.mode;
      repeat = schedule.repeat;
    }
    draftEnabled = persisted?.enabled ?? true;
    validationError = "";
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

  function changeMode(event: Event): void {
    const value = (event.currentTarget as HTMLSelectElement).value;
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
        if (enabled) restartTimeNode(note.id);
      },
      undo: () => {
        updateNote(note.id, { time: copyTimeData(previous)! });
        if (previous.enabled) restartTimeNode(note.id);
      },
    });
  }

  function scheduleKey(schedule: TimeSchedule): string {
    return schedule.kind === "at"
      ? `at|${schedule.date ?? ""}|${schedule.time}`
      : `interval|${schedule.minutes}|${schedule.mode}|${schedule.repeat}`;
  }

  function copyTimeData(data: TimeNodeData | undefined): TimeNodeData | null {
    if (!data) return null;
    return {
      schedule: copyTimeSchedule(data.schedule),
      enabled: data.enabled,
      ...(data.runtime ? { runtime: { ...data.runtime } } : {}),
    };
  }
</script>

<section class="time-editor" data-time-body data-time-mode={mode} aria-label="Reminder schedule">
  <label class="time-field mode-field">
    <span>Mode</span>
    <select aria-label="Reminder mode" value={mode} onchange={changeMode}>
      <option value="at">At time</option>
      <option value="interval">Interval</option>
    </select>
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
      <select aria-label="Interval count mode" bind:value={countMode}>
        <option value="calendar">Calendar time</option>
        <option value="app">While hive runs (incl. tray)</option>
        <option value="active">While hive window is active</option>
      </select>
    </label>
    <label class="time-check">
      <input type="checkbox" bind:checked={repeat} />
      <span>Repeat</span>
    </label>
  {/if}

  {#if validationError}
    <p class="time-error" role="alert" data-time-validation>{validationError}</p>
  {/if}

  <div class="time-actions">
    <label class="time-check enabled-check">
      <input type="checkbox" checked={draftEnabled} onchange={setEnabled} />
      <span>Enabled</span>
    </label>
    <button type="button" class="time-save" onclick={saveSchedule}>Save schedule</button>
  </div>
  <p class="time-status" role="status" aria-live="polite" data-time-status>{status}</p>
  <TaskLinkStatus noteId={note.id} />
</section>

<style>
  .time-editor { display: grid; gap: 7px; padding: 8px; color: #d4d4d4; font-size: 10px; }
  .time-field { display: grid; min-width: 0; gap: 3px; color: #aaa; }
  .time-field > span { font-size: 9px; }
  .time-field input, .time-field select {
    box-sizing: border-box; width: 100%; min-width: 0; height: 25px; padding: 0 5px;
    color: #e3e3e3; background: #252727; border: 1px solid #494c4b; border-radius: 3px; font: inherit;
  }
  .time-field input:focus-visible, .time-field select:focus-visible, .time-save:focus-visible, .time-check input:focus-visible { outline: 1px solid #d6ad53; outline-offset: 1px; }
  .time-field small, .time-helper { margin: 0; color: #8b918e; font-size: 9px; }
  .time-check { display: inline-flex; min-height: 22px; align-items: center; gap: 6px; color: #c5c9c7; }
  .time-check input { accent-color: #d2a847; }
  .time-actions { display: flex; align-items: center; justify-content: space-between; gap: 6px; padding-top: 3px; border-top: 1px solid #3c403e; }
  .time-save { min-height: 23px; padding: 2px 7px; color: #dedede; background: #333735; border: 1px solid #505552; border-radius: 3px; font: inherit; cursor: pointer; }
  .time-save:hover { background: #3d423f; }
  .time-status { margin: 0; padding-top: 5px; color: #a2b7a1; border-top: 1px solid #3c403e; font-variant-numeric: tabular-nums; }
  .time-error { margin: 0; color: #e38b83; font-size: 9px; }
</style>
