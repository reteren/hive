<script lang="ts">
  import { board } from "../model/board.svelte";
  import { links } from "../model/links.svelte";
  import { teleportToObject } from "../navigation/navigate";
  import { occurrencesBetween } from "../time/scheduler";
  import { calendarOccurrences, formatOccurrenceTime, localDateKey, monthGrid, occurrencesOnDay, visibleGridRange } from "./calendarLogic";
  import type { Note } from "../model/note";

  const initialNow = new Date();
  let now = $state(initialNow);
  let month = $state(new Date(initialNow.getFullYear(), initialNow.getMonth(), 1, 12));
  let selectedDay = $state(localDateKey(initialNow));
  let previousBoardNotes = board.notes;

  $effect(() => {
    const notes = board.notes;
    if (notes === previousBoardNotes) return;
    previousBoardNotes = notes;
    now = new Date();
    month = new Date(now.getFullYear(), now.getMonth(), 1, 12);
    selectedDay = localDateKey(now);
  });

  $effect(() => {
    const today = now;
    const nextMidnight = new Date(today.getFullYear(), today.getMonth(), today.getDate() + 1).getTime();
    const timeout = window.setTimeout(() => { now = new Date(); }, Math.max(1, nextMidnight - Date.now() + 10));
    return () => window.clearTimeout(timeout);
  });

  const days = $derived(monthGrid(month.getFullYear(), month.getMonth(), now));
  const range = $derived(visibleGridRange(days));
  const occurrences = $derived(calendarOccurrences(
    Object.values(board.notes) as Note[],
    Object.values(links.byId),
    board.order,
    range.fromMs,
    range.toMs,
    occurrencesBetween,
    selectedDay,
  ));
  const selectedOccurrences = $derived(occurrencesOnDay(occurrences, selectedDay));
  const occurrenceCountByDay = $derived(occurrences.reduce((counts, item) => {
    const key = localDateKey(new Date(item.dueAt));
    counts.set(key, (counts.get(key) ?? 0) + 1);
    return counts;
  }, new Map<string, number>()));
  const title = $derived(new Intl.DateTimeFormat("en", { month: "long", year: "numeric" }).format(month));
  const weekdays = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];

  function moveMonth(amount: number): void {
    const nextMonth = new Date(month.getFullYear(), month.getMonth() + amount, 1, 12);
    const selectedDayNumber = Number(selectedDay.slice(-2));
    const dayCount = new Date(nextMonth.getFullYear(), nextMonth.getMonth() + 1, 0).getDate();
    month = nextMonth;
    selectedDay = localDateKey(new Date(nextMonth.getFullYear(), nextMonth.getMonth(), Math.min(selectedDayNumber, dayCount), 12));
  }

  function selectDay(day: (typeof days)[number]): void {
    selectedDay = day.key;
    if (!day.inCurrentMonth) month = new Date(day.date.getFullYear(), day.date.getMonth(), 1, 12);
  }

  function showToday(): void {
    now = new Date();
    month = new Date(now.getFullYear(), now.getMonth(), 1, 12);
    selectedDay = localDateKey(now);
  }

  function goTo(targetId: string): void {
    teleportToObject(targetId, { label: "Go to reminder" });
  }
</script>

<section class="calendar-body" aria-label="Calendar" data-calendar-body>
  <div class="calendar-heading">
    <button type="button" aria-label="Previous month" title="Previous month" data-selection-ignore onclick={() => moveMonth(-1)}>‹</button>
    <h2>{title}</h2>
    <button type="button" aria-label="Next month" title="Next month" data-selection-ignore onclick={() => moveMonth(1)}>›</button>
    <button class="today-button" type="button" data-selection-ignore onclick={showToday}>Today</button>
  </div>

  <div class="calendar-grid" role="group" aria-label={title}>
    {#each weekdays as weekday}
      <span class="weekday" aria-label={weekday}>{weekday.slice(0, 2)}</span>
    {/each}
    {#each days as day (day.key)}
      {@const count = occurrenceCountByDay.get(day.key) ?? 0}
      <button
        class="calendar-day"
        class:outside={!day.inCurrentMonth}
        class:today={day.isToday}
        class:selected={day.key === selectedDay}
        type="button"
        aria-label={`${day.date.toLocaleDateString()}${count ? `, ${count} reminders` : ""}`}
        aria-pressed={day.key === selectedDay}
        data-calendar-day={day.key}
        data-selection-ignore
        onclick={() => selectDay(day)}
      >
        <span>{day.date.getDate()}</span>
        {#if count === 1}<span class="day-dot" aria-hidden="true">•</span>
        {:else if count > 1}<span class="day-count" aria-label={`${count} reminders`}>{count > 9 ? "9+" : count}</span>{/if}
      </button>
    {/each}
  </div>

  <div class="calendar-reminders" aria-live="polite" data-calendar-reminders>
    {#if selectedOccurrences.length === 0}
      <p class="empty-reminders">No reminders</p>
    {:else}
      {#each selectedOccurrences as item (`${item.timeId}-${item.dueAt}`)}
        <div class="calendar-reminder" data-calendar-occurrence>
          <span>{formatOccurrenceTime(item.dueAt)} · {item.summary}</span>
          <button type="button" data-selection-ignore onclick={() => goTo(item.targetId)}>Go to</button>
        </div>
      {/each}
    {/if}
  </div>
</section>

<style>
  .calendar-body { display: grid; min-width: 0; height: 100%; box-sizing: border-box; grid-template-rows: auto auto minmax(0, 1fr); gap: 5px; padding: 5px; color: #d7dbd8; font-size: 10px; }
  .calendar-heading { display: flex; min-width: 0; align-items: center; gap: 4px; }
  .calendar-heading h2 { flex: 1; margin: 0; overflow: hidden; color: #e1e5e2; font-size: 11px; font-weight: 600; text-align: center; text-overflow: ellipsis; white-space: nowrap; }
  .calendar-heading button, .calendar-reminder button { min-width: 22px; min-height: 21px; padding: 1px 5px; color: #c8ceca; background: #303532; border: 1px solid #494f4b; border-radius: 3px; font: inherit; cursor: pointer; }
  .calendar-heading button:hover, .calendar-reminder button:hover { background: #3b423e; border-color: #626b65; }
  .calendar-heading .today-button { margin-left: 3px; }
  .calendar-grid { display: grid; min-width: 0; grid-template-columns: repeat(7, minmax(0, 1fr)); grid-auto-rows: minmax(24px, 1fr); gap: 2px; }
  .weekday { display: grid; min-width: 0; min-height: 16px; place-items: center; color: #929b95; font-size: 8px; font-weight: 600; }
  .calendar-day { position: relative; display: flex; min-width: 0; align-items: center; justify-content: center; padding: 0; color: #d6dbd7; background: #282d2a; border: 1px solid #3e4541; border-radius: 3px; font: inherit; font-variant-numeric: tabular-nums; cursor: pointer; }
  .calendar-day.outside { color: #737c76; background: #232725; }
  .calendar-day.today { outline: 1px solid #d5b65b; outline-offset: -2px; }
  .calendar-day.selected { background: #394b43; border-color: #79a38b; }
  .day-dot { position: absolute; bottom: 0; color: #85c89d; font-size: 13px; line-height: 9px; }
  .day-count { position: absolute; right: 2px; bottom: 1px; color: #8fd0a4; font-size: 7px; font-weight: 700; line-height: 9px; }
  .calendar-reminders { display: grid; min-height: 0; align-content: start; gap: 3px; overflow: auto; border-top: 1px solid #404743; padding-top: 4px; }
  .empty-reminders { margin: 0; color: #929b95; text-align: center; }
  .calendar-reminder { display: flex; min-width: 0; align-items: center; gap: 5px; }
  .calendar-reminder span { flex: 1; min-width: 0; overflow: hidden; color: #c9cfcb; text-overflow: ellipsis; white-space: nowrap; font-variant-numeric: tabular-nums; }
  .calendar-reminder button { min-height: 19px; flex: 0 0 auto; }
</style>
