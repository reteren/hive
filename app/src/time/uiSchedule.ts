import type { TimeSchedule } from "./types";

const HOUR_MS = 60 * 60 * 1_000;
const FIVE_MINUTES_MS = 5 * 60 * 1_000;

/** New Time nodes start one hour from now, rounded up to the next five-minute mark. */
export function defaultAtTimeSchedule(now: number): Extract<TimeSchedule, { kind: "at" }> {
  const due = new Date(Math.ceil((now + HOUR_MS) / FIVE_MINUTES_MS) * FIVE_MINUTES_MS);
  return { kind: "at", date: null, time: `${twoDigits(due.getHours())}:${twoDigits(due.getMinutes())}` };
}

export function copyTimeSchedule(schedule: TimeSchedule): TimeSchedule {
  return schedule.kind === "at" ? { ...schedule } : { ...schedule };
}

/** Stable, per-node ids keep each Time node's Repeat and Enabled controls independent. */
export function timeCheckboxId(noteId: string, field: "repeat" | "enabled"): string {
  return `time-${encodeURIComponent(noteId)}-${field}`;
}

/** A compact hours equivalent shown next to the canonical minutes field. */
export function intervalHoursHint(minutes: number): string {
  if (!Number.isFinite(minutes) || minutes < 1) return "Enter at least 1 minute.";
  const hours = Math.floor(minutes / 60);
  const remainder = minutes % 60;
  if (hours === 0) return `${minutes} ${minutes === 1 ? "minute" : "minutes"}`;
  if (remainder === 0) return `${hours} ${hours === 1 ? "hour" : "hours"}`;
  return `${hours} h ${remainder} min`;
}

export function formatCountdown(milliseconds: number): string {
  const seconds = Math.max(0, Math.ceil(milliseconds / 1_000));
  const hours = Math.floor(seconds / 3_600);
  const minutes = Math.floor((seconds % 3_600) / 60);
  const remainingSeconds = seconds % 60;
  if (hours > 0) {
    const roundedMinutes = Math.ceil((seconds % 3_600) / 60);
    return roundedMinutes === 60 ? `${hours + 1}h 0m` : `${hours}h ${roundedMinutes}m`;
  }
  if (minutes > 0) return `${minutes}m ${remainingSeconds}s`;
  return `${remainingSeconds}s`;
}

function twoDigits(value: number): string {
  return String(value).padStart(2, "0");
}
