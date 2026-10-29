import type { Point } from "../board/cameraMath";

/** Side of one heat-map cell in board units. */
export const ATTENTION_CELL = 40;
/** Zone bucket for time spent looking at the board outside every zone. */
export const OUTSIDE_ZONES = "";
/** Days of history kept; older days are dropped on save. */
export const ATTENTION_KEEP_DAYS = 120;

export type AttentionPeriod = "today" | "week" | "month" | "all";
export const ATTENTION_PERIODS: readonly AttentionPeriod[] = ["today", "week", "month", "all"];

/** Seconds per heat cell and per zone for one local calendar day. */
export interface AttentionDay {
  cells: Record<string, number>;
  zones: Record<string, number>;
  total: number;
}

/** Keyed by local day, "YYYY-MM-DD". */
export type AttentionLog = Record<string, AttentionDay>;

export interface AttentionSummary {
  cells: { x: number; y: number; seconds: number }[];
  zones: Record<string, number>;
  total: number;
  maxCell: number;
}

export function attentionDayKey(date: Date): string {
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

export function attentionCellKey(point: Point): string {
  return `${Math.floor(point.x / ATTENTION_CELL)},${Math.floor(point.y / ATTENTION_CELL)}`;
}

export function recordAttention(log: AttentionLog, day: string, point: Point, zoneId: string, seconds: number): void {
  if (!Number.isFinite(point.x) || !Number.isFinite(point.y) || !(seconds > 0)) return;
  const entry = log[day] ??= { cells: {}, zones: {}, total: 0 };
  const cell = attentionCellKey(point);
  entry.cells[cell] = (entry.cells[cell] ?? 0) + seconds;
  entry.zones[zoneId] = (entry.zones[zoneId] ?? 0) + seconds;
  entry.total += seconds;
}

/** Day keys a period covers, or null for all of history. */
export function periodDayKeys(period: AttentionPeriod, now: Date): Set<string> | null {
  if (period === "all") return null;
  const count = period === "today" ? 1 : period === "week" ? 7 : 30;
  const keys = new Set<string>();
  for (let offset = 0; offset < count; offset += 1) {
    keys.add(attentionDayKey(new Date(now.getFullYear(), now.getMonth(), now.getDate() - offset)));
  }
  return keys;
}

export function summarizeAttention(log: Readonly<AttentionLog>, period: AttentionPeriod, now: Date): AttentionSummary {
  const days = periodDayKeys(period, now);
  const cells = new Map<string, number>();
  const zones: Record<string, number> = {};
  let total = 0;
  for (const [day, entry] of Object.entries(log)) {
    if (days && !days.has(day)) continue;
    for (const [cell, seconds] of Object.entries(entry.cells)) cells.set(cell, (cells.get(cell) ?? 0) + seconds);
    for (const [zone, seconds] of Object.entries(entry.zones)) zones[zone] = (zones[zone] ?? 0) + seconds;
    total += entry.total;
  }
  let maxCell = 0;
  const cellList = [...cells].map(([key, seconds]) => {
    const [x, y] = key.split(",").map(Number);
    maxCell = Math.max(maxCell, seconds);
    return { x: x * ATTENTION_CELL, y: y * ATTENTION_CELL, seconds };
  });
  return { cells: cellList, zones, total, maxCell };
}

export function pruneAttention(log: AttentionLog, now: Date, keepDays = ATTENTION_KEEP_DAYS): void {
  const oldest = attentionDayKey(new Date(now.getFullYear(), now.getMonth(), now.getDate() - keepDays + 1));
  for (const day of Object.keys(log)) if (day < oldest) delete log[day];
}

function numberRecord(value: unknown): Record<string, number> {
  if (!value || typeof value !== "object") return {};
  return Object.fromEntries(Object.entries(value as Record<string, unknown>)
    .filter((entry): entry is [string, number] => typeof entry[1] === "number" && Number.isFinite(entry[1]) && entry[1] > 0));
}

export function parseAttentionLog(value: unknown): AttentionLog {
  if (!value || typeof value !== "object") return {};
  const log: AttentionLog = {};
  for (const [day, raw] of Object.entries(value as Record<string, unknown>)) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || !raw || typeof raw !== "object") continue;
    const entry = raw as Record<string, unknown>;
    const zones = numberRecord(entry.zones);
    const total = typeof entry.total === "number" && entry.total > 0 ? entry.total : 0;
    log[day] = { cells: numberRecord(entry.cells), zones, total };
  }
  return log;
}

/** Whole percent of `part` in `total`, never NaN. */
export function attentionPercent(part: number, total: number): number {
  return total > 0 ? Math.round((part / total) * 100) : 0;
}
