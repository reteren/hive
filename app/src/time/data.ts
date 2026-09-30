import type { TimeNodeData, StopwatchData } from "./types";

export function copyTimeNodeData(value: TimeNodeData): TimeNodeData {
  return {
    schedule: { ...value.schedule },
    enabled: value.enabled,
    ...(value.taskMode ? { taskMode: value.taskMode } : {}),
    ...(value.view ? { view: value.view } : {}),
    ...(value.stopwatch ? { stopwatch: { ...value.stopwatch } } : {}),
    ...(value.runtime ? { runtime: { ...value.runtime } } : {}),
  };
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
