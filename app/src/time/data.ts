import type { CalendarRule, TimeNodeData, StopwatchData } from "./types";

export function copyTimeNodeData(value: TimeNodeData): TimeNodeData {
  return {
    schedule: value.schedule.kind === "at"
      ? { ...value.schedule, ...(value.schedule.rule ? { rule: copyCalendarRule(value.schedule.rule) } : {}) }
      : { ...value.schedule },
    enabled: value.enabled,
    ...(value.taskMode ? { taskMode: value.taskMode } : {}),
    ...(value.view ? { view: value.view } : {}),
    ...(value.stopwatch ? { stopwatch: { ...value.stopwatch } } : {}),
    ...(value.runtime ? { runtime: { ...value.runtime } } : {}),
  };
}

/** Parse a calendar repeat rule; absent means legacy behavior and null means malformed data. */
export function parseCalendarRule(value: unknown): CalendarRule | undefined | null {
  if (value === undefined) return undefined;
  if (!isRecord(value)) return null;
  switch (value.type) {
    case "weekly":
      if (!Array.isArray(value.days) || value.days.length === 0 ||
        !value.days.every((day) => Number.isInteger(day) && day >= 0 && day <= 6) ||
        new Set(value.days).size !== value.days.length) return null;
      return { type: "weekly", days: [...value.days] as number[] };
    case "workdays": return { type: "workdays" };
    case "monthly":
      return Number.isInteger(value.day) && (value.day as number) >= 1 && (value.day as number) <= 31
        ? { type: "monthly", day: value.day as number }
        : null;
    case "yearly": {
      const month = value.month;
      const day = value.day;
      const daysInMonth = typeof month === "number" && Number.isInteger(month) && month >= 1 && month <= 12
        ? [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1]!
        : 0;
      return Number.isInteger(day) && (day as number) >= 1 && (day as number) <= daysInMonth
        ? { type: "yearly", month: month as number, day: day as number }
        : null;
    }
    default: return null;
  }
}

function copyCalendarRule(rule: CalendarRule): CalendarRule {
  return rule.type === "weekly" ? { ...rule, days: [...rule.days] } : { ...rule };
}

export function copyStopwatchData(value: StopwatchData | undefined): StopwatchData | undefined {
  return value ? { ...value } : undefined;
}

/** Strictly validate persisted stopwatch settings while ignoring unknown future properties. */
export function parseStopwatchData(value: unknown): StopwatchData | null | undefined {
  if (value === undefined) return undefined;
  if (!isRecord(value) || !isStopwatchMode(value.mode)) return null;
  if (value.includeProjectTime !== undefined && typeof value.includeProjectTime !== "boolean" ||
    value.running !== undefined && typeof value.running !== "boolean" ||
    value.elapsedMs !== undefined && !finiteNonnegative(value.elapsedMs) ||
    value.startedAt !== undefined && !finiteNonnegative(value.startedAt) ||
    value.nodeCreatedAppMs !== undefined && !finiteNonnegative(value.nodeCreatedAppMs) ||
    value.nodeCreatedActiveMs !== undefined && !finiteNonnegative(value.nodeCreatedActiveMs)) return null;
  return {
    mode: value.mode,
    ...(typeof value.includeProjectTime === "boolean" ? { includeProjectTime: value.includeProjectTime } : {}),
    ...(typeof value.running === "boolean" ? { running: value.running } : {}),
    ...(typeof value.elapsedMs === "number" ? { elapsedMs: value.elapsedMs } : {}),
    ...(typeof value.startedAt === "number" ? { startedAt: value.startedAt } : {}),
    ...(typeof value.nodeCreatedAppMs === "number" ? { nodeCreatedAppMs: value.nodeCreatedAppMs } : {}),
    ...(typeof value.nodeCreatedActiveMs === "number" ? { nodeCreatedActiveMs: value.nodeCreatedActiveMs } : {}),
  };
}

function isStopwatchMode(value: unknown): value is StopwatchData["mode"] {
  return value === "project" || value === "node" || value === "session" || value === "taskCreated"
    || value === "taskDone" || value === "active" || value === "app" || value === "manual";
}

function finiteNonnegative(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
