import { COUNT_MODES, type CountMode, type TimeNodeData, type TimeRuntime, type TimeSchedule } from "./types";

/** Clock values supplied by the runtime service. App and active totals are monotonic. */
export interface TimeContext {
  now: number;
  appMs: number;
  activeMs: number;
}

/** One occurrence that should be delivered to the message queue. */
export interface TimeFire {
  key: string;
  dueAt: number;
  overlate: boolean;
}

const MINUTE_MS = 60_000;
// The runtime ticks once per second, so small scheduling jitter is not presented as lateness.
const LATE_THRESHOLD_MS = 1_500;

/** Returns a validation message, or null when a schedule can be evaluated. */
export function validateSchedule(schedule: TimeSchedule): string | null {
  if (!schedule || typeof schedule !== "object") return "Choose a time schedule.";

  if (schedule.kind === "at") {
    if (!isValidTime(schedule.time)) return "Enter a time in HH:MM format.";
    if (schedule.date !== null && !isValidDate(schedule.date)) return "Enter a valid date in YYYY-MM-DD format.";
    return null;
  }

  if (schedule.kind === "interval") {
    if (!Number.isFinite(schedule.minutes) || schedule.minutes < 1) return "Interval must be at least 1 minute.";
    if (!isCountMode(schedule.mode)) return "Choose a valid interval count mode.";
    return null;
  }

  return "Choose a valid time schedule.";
}

/**
 * Starts a clean schedule runtime. Call after creating/editing a schedule or explicitly re-enabling it.
 * The initial check point intentionally skips a one-shot whose due time is already past at creation.
 */
export function startRuntime(schedule: TimeSchedule, context: TimeContext): TimeRuntime {
  const runtime: TimeRuntime = { lastCheckedAt: context.now };
  if (schedule.kind === "interval") {
    if (schedule.mode === "calendar") runtime.intervalStartedAt = context.now;
    else runtime.countedMs = counterForMode(schedule.mode, context);
  }
  return runtime;
}

/** Evaluates one enabled Time node and returns no more than one occurrence per call. */
export function evaluateTime(data: TimeNodeData, context: TimeContext): { fire: TimeFire | null; runtime: TimeRuntime } {
  const runtime = normalizedRuntime(data.schedule, data.runtime, context);
  if (!data.enabled || validateSchedule(data.schedule) !== null) return { fire: null, runtime };

  if (data.schedule.kind === "at") return evaluateAt(data.schedule, runtime, context);
  return evaluateInterval(data.schedule, runtime, context);
}

/** Estimates the wall-clock time of the next occurrence, or null for a stopped/completed schedule. */
export function nextDueAt(data: TimeNodeData, context: TimeContext): number | null {
  if (!data.enabled || validateSchedule(data.schedule) !== null) return null;
  const runtime = normalizedRuntime(data.schedule, data.runtime, context);

  if (data.schedule.kind === "at") {
    if (data.schedule.date !== null) {
      const dueAt = localDateTime(data.schedule.date, data.schedule.time);
      const key = `${data.schedule.date}T${data.schedule.time}`;
      if (runtime.lastFiredKey === key || dueAt < (runtime.lastCheckedAt ?? context.now)) return null;
      return dueAt;
    }

    const highWaterNow = Math.max(context.now, runtime.lastCheckedAt ?? context.now);
    const latest = latestDailyOccurrence(data.schedule.time, highWaterNow);
    const latestKey = localDateKey(latest.dueAt, data.schedule.time);
    if (
      latest.dueAt > (runtime.lastCheckedAt ?? context.now) &&
      latest.dueAt <= highWaterNow &&
      runtime.lastFiredKey !== latestKey
    ) {
      return latest.dueAt;
    }

    const next = nextDailyOccurrence(data.schedule.time, highWaterNow);
    const nextKey = localDateKey(next, data.schedule.time);
    return runtime.lastFiredKey === nextKey ? nextDailyOccurrence(data.schedule.time, next) : next;
  }

  if (!data.schedule.repeat && runtime.lastFiredKey) return null;
  const durationMs = data.schedule.minutes * MINUTE_MS;
  if (data.schedule.mode === "calendar") {
    const startedAt = finiteOr(runtime.intervalStartedAt, context.now);
    return startedAt + durationMs;
  }

  const startedAt = finiteOr(runtime.countedMs, counterForMode(data.schedule.mode, context));
  const elapsed = counterForMode(data.schedule.mode, context) - startedAt;
  return context.now + Math.max(0, durationMs - elapsed);
}

function evaluateAt(
  schedule: Extract<TimeSchedule, { kind: "at" }>,
  runtime: TimeRuntime,
  context: TimeContext,
): { fire: TimeFire | null; runtime: TimeRuntime } {
  const previousCheck = runtime.lastCheckedAt ?? context.now;
  const checkedAt = highWater(previousCheck, context.now);

  if (schedule.date !== null) {
    const dueAt = localDateTime(schedule.date, schedule.time);
    const key = `${schedule.date}T${schedule.time}`;
    const eligible = dueAt >= previousCheck && dueAt <= context.now && key !== runtime.lastFiredKey;
    if (eligible) {
      const nextRuntime = { ...runtime, lastFiredKey: key, lastCheckedAt: checkedAt };
      return { fire: { key, dueAt, overlate: isLate(dueAt, previousCheck, context.now) }, runtime: nextRuntime };
    }
    return { fire: null, runtime: { ...runtime, lastCheckedAt: checkedAt } };
  }

  const occurrence = latestDailyOccurrence(schedule.time, context.now);
  const key = localDateKey(occurrence.dueAt, schedule.time);
  const eligible = occurrence.dueAt >= previousCheck && occurrence.dueAt <= context.now && key !== runtime.lastFiredKey;
  if (!eligible) return { fire: null, runtime: { ...runtime, lastCheckedAt: checkedAt } };

  const missedEarlierOccurrence = hasEarlierDailyOccurrence(schedule.time, previousCheck, occurrence.dueAt);
  return {
    fire: {
      key,
      dueAt: occurrence.dueAt,
      overlate: missedEarlierOccurrence || isLate(occurrence.dueAt, previousCheck, context.now),
    },
    runtime: { ...runtime, lastFiredKey: key, lastCheckedAt: checkedAt },
  };
}

function evaluateInterval(
  schedule: Extract<TimeSchedule, { kind: "interval" }>,
  runtime: TimeRuntime,
  context: TimeContext,
): { fire: TimeFire | null; runtime: TimeRuntime } {
  if (!schedule.repeat && runtime.lastFiredKey) {
    return { fire: null, runtime: { ...runtime, lastCheckedAt: highWater(runtime.lastCheckedAt ?? context.now, context.now) } };
  }

  const durationMs = schedule.minutes * MINUTE_MS;
  const previousCheck = runtime.lastCheckedAt ?? context.now;
  const checkedAt = highWater(previousCheck, context.now);
  const counter = counterForMode(schedule.mode, context);
  const start = schedule.mode === "calendar"
    ? finiteOr(runtime.intervalStartedAt, context.now)
    : finiteOr(runtime.countedMs, counter);
  const elapsed = schedule.mode === "calendar" ? context.now - start : counter - start;

  if (elapsed < durationMs) return { fire: null, runtime: { ...runtime, lastCheckedAt: checkedAt } };

  const occurrenceCount = Math.max(1, Math.floor(elapsed / durationMs));
  const key = `interval:${schedule.mode}:${start}:${occurrenceCount}`;
  if (key === runtime.lastFiredKey) return { fire: null, runtime: { ...runtime, lastCheckedAt: checkedAt } };

  const scheduledDueAt = schedule.mode === "calendar"
    ? start + durationMs * occurrenceCount
    : context.now - Math.max(0, elapsed - durationMs * occurrenceCount);
  const late = occurrenceCount > 1 || isLate(scheduledDueAt, previousCheck, context.now);
  const nextRuntime: TimeRuntime = { ...runtime, lastFiredKey: key, lastCheckedAt: checkedAt };

  if (schedule.repeat) {
    // Coalesce missed repeats into one delivery, then restart from the actual firing moment.
    if (schedule.mode === "calendar") nextRuntime.intervalStartedAt = context.now;
    else nextRuntime.countedMs = counter;
  }

  return { fire: { key, dueAt: scheduledDueAt, overlate: late }, runtime: nextRuntime };
}

function normalizedRuntime(schedule: TimeSchedule, saved: TimeRuntime | undefined, context: TimeContext): TimeRuntime {
  if (!saved) return startRuntime(schedule, context);
  const started = startRuntime(schedule, context);
  return {
    ...started,
    ...saved,
    lastCheckedAt: Number.isFinite(saved.lastCheckedAt) ? saved.lastCheckedAt : context.now,
  };
}

function latestDailyOccurrence(time: string, now: number): { dueAt: number } {
  const [hour, minute] = time.split(":").map(Number);
  const day = localDayAt(now);
  let dueAt = localDateTimeFromParts(day.getFullYear(), day.getMonth() + 1, day.getDate(), hour, minute);
  if (dueAt > now) {
    day.setDate(day.getDate() - 1);
    dueAt = localDateTimeFromParts(day.getFullYear(), day.getMonth() + 1, day.getDate(), hour, minute);
  }
  return { dueAt };
}

function nextDailyOccurrence(time: string, after: number): number {
  const [hour, minute] = time.split(":").map(Number);
  const day = localDayAt(after);
  let dueAt = localDateTimeFromParts(day.getFullYear(), day.getMonth() + 1, day.getDate(), hour, minute);
  if (dueAt <= after) {
    day.setDate(day.getDate() + 1);
    dueAt = localDateTimeFromParts(day.getFullYear(), day.getMonth() + 1, day.getDate(), hour, minute);
  }
  return dueAt;
}

function hasEarlierDailyOccurrence(time: string, after: number, latestDueAt: number): boolean {
  const [hour, minute] = time.split(":").map(Number);
  const day = localDayAt(after);
  let first = localDateTimeFromParts(day.getFullYear(), day.getMonth() + 1, day.getDate(), hour, minute);
  if (first < after) {
    day.setDate(day.getDate() + 1);
    first = localDateTimeFromParts(day.getFullYear(), day.getMonth() + 1, day.getDate(), hour, minute);
  }
  return first < latestDueAt;
}

function localDateTime(date: string, time: string): number {
  const [year, month, day] = date.split("-").map(Number);
  const [hour, minute] = time.split(":").map(Number);
  return localDateTimeFromParts(year, month, day, hour, minute);
}

function localDateTimeFromParts(year: number, month: number, day: number, hour: number, minute: number): number {
  const date = localDayFromParts(year, month, day);
  date.setHours(hour, minute, 0, 0);
  return date.getTime();
}

function localDayAt(timestamp: number): Date {
  const value = new Date(timestamp);
  return localDayFromParts(value.getFullYear(), value.getMonth() + 1, value.getDate());
}

/** Noon avoids midnight transitions in rare local time zones with DST changes at midnight. */
function localDayFromParts(year: number, month: number, day: number): Date {
  const value = new Date(0);
  value.setFullYear(year, month - 1, day);
  value.setHours(12, 0, 0, 0);
  return value;
}

function localDateKey(timestamp: number, time: string): string {
  const date = new Date(timestamp);
  return `${formatYear(date.getFullYear())}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}T${time}`;
}

function isLate(dueAt: number, previousCheck: number, now: number): boolean {
  return now - previousCheck > LATE_THRESHOLD_MS || now - dueAt > LATE_THRESHOLD_MS;
}

function highWater(previous: number, current: number): number {
  return Math.max(previous, current);
}

function counterForMode(mode: CountMode, context: TimeContext): number {
  return mode === "app" ? context.appMs : mode === "active" ? context.activeMs : context.now;
}

function finiteOr(value: number | undefined, fallback: number): number {
  return value !== undefined && Number.isFinite(value) ? value : fallback;
}

function isCountMode(mode: unknown): mode is CountMode {
  return COUNT_MODES.some((candidate) => candidate === mode);
}

function isValidTime(time: unknown): time is string {
  if (typeof time !== "string" || !/^\d{2}:\d{2}$/.test(time)) return false;
  const [hour, minute] = time.split(":").map(Number);
  return hour >= 0 && hour <= 23 && minute >= 0 && minute <= 59;
}

function isValidDate(date: unknown): date is string {
  if (typeof date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return false;
  const [year, month, day] = date.split("-").map(Number);
  const utcDate = new Date(0);
  utcDate.setUTCHours(0, 0, 0, 0);
  utcDate.setUTCFullYear(year, month - 1, day);
  return utcDate.getUTCFullYear() === year && utcDate.getUTCMonth() === month - 1 && utcDate.getUTCDate() === day;
}

function formatYear(year: number): string {
  return String(year).padStart(4, "0");
}

function pad2(value: number): string {
  return String(value).padStart(2, "0");
}
