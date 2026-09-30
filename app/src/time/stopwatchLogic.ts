import type { ProjectTimeCounters, StopwatchData, StopwatchMode } from "./types";

export interface StopwatchDisplayParts {
  days: number;
  hours: string;
  minutes: string;
  seconds: string;
}

export function stopwatchElapsedMs(input: {
  mode: StopwatchMode;
  noteCreatedAt: number | undefined;
  projectCreatedAt: number;
  sessionStartedAt: number | null;
  linkedTask: { createdAt: number | undefined; doneAt: number | null } | null;
  counters: ProjectTimeCounters;
  stopwatch: StopwatchData;
  now: number;
}): number | null {
  const { mode, noteCreatedAt, projectCreatedAt, sessionStartedAt, linkedTask, counters, stopwatch, now } = input;
  if (mode === "project") return Math.max(0, now - projectCreatedAt);
  if (mode === "node") return Math.max(0, now - (noteCreatedAt ?? projectCreatedAt));
  if (mode === "session") return sessionStartedAt === null ? null : Math.max(0, now - sessionStartedAt);
  if (mode === "taskCreated") return linkedTask?.createdAt === undefined ? null : Math.max(0, now - linkedTask.createdAt);
  if (mode === "taskDone") return linkedTask?.doneAt === null || linkedTask?.doneAt === undefined
    ? null : Math.max(0, now - linkedTask.doneAt);
  if (mode === "active") {
    const elapsed = stopwatch.includeProjectTime
      ? counters.activeMs
      : counters.activeMs - (stopwatch.nodeCreatedActiveMs ?? 0);
    return Math.max(0, elapsed);
  }
  if (mode === "app") {
    const elapsed = stopwatch.includeProjectTime
      ? counters.appMs
      : counters.appMs - (stopwatch.nodeCreatedAppMs ?? 0);
    return Math.max(0, elapsed);
  }
  const saved = nonNegative(stopwatch.elapsedMs ?? 0);
  return saved + (stopwatch.running ? Math.max(0, now - (stopwatch.startedAt ?? now)) : 0);
}

export function toggleManualStopwatch(stopwatch: StopwatchData, now: number): StopwatchData {
  if (stopwatch.running) {
    return {
      ...stopwatch,
      running: false,
      elapsedMs: nonNegative(stopwatch.elapsedMs ?? 0) + Math.max(0, now - (stopwatch.startedAt ?? now)),
      startedAt: undefined,
    };
  }
  return { ...stopwatch, running: true, startedAt: now };
}

export function formatStopwatch(milliseconds: number): StopwatchDisplayParts {
  const seconds = Math.floor(nonNegative(milliseconds) / 1_000);
  const days = Math.floor(seconds / 86_400);
  const hours = Math.floor((seconds % 86_400) / 3_600);
  const minutes = Math.floor((seconds % 3_600) / 60);
  const remainingSeconds = seconds % 60;
  return {
    days,
    hours: twoDigits(hours),
    minutes: twoDigits(minutes),
    seconds: twoDigits(remainingSeconds),
  };
}

function twoDigits(value: number): string {
  return String(value).padStart(2, "0");
}

function nonNegative(value: number): number {
  return Number.isFinite(value) ? Math.max(0, value) : 0;
}
