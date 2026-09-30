/**
 * R8 shared contract for Time and Message nodes. Every R8 worker builds on these shapes;
 * change them only through the coordinator.
 */

/** R8.3 counting modes for intervals: wall clock, hive process running (tray included), hive window focused. */
export type CountMode = "calendar" | "app" | "active";

export const COUNT_MODES: readonly CountMode[] = ["calendar", "app", "active"];

/** Default mode for a new interval (user decision 28.09): calendar time. */
export const DEFAULT_COUNT_MODE: CountMode = "calendar";

/**
 * R8.1/R8.2 schedule of a Time node.
 * - "at": time is required ("HH:MM", 24 h). With a date ("YYYY-MM-DD") it fires once at that
 *   moment; with date null it fires every day at that time. A calendar date without a time
 *   cannot be saved.
 * - "interval": fires `minutes` after its start, counted in `mode`; `repeat` restarts the count
 *   after each firing.
 */
/**
 * R8.7 calendar repeat rule for an "at" schedule (optional; absent = old behaviour: date → once,
 * no date → every day). With a rule, `date` is ignored except as the first allowed day (null = today).
 * - weekly: fires at `time` on the listed weekdays (0 = Sunday … 6 = Saturday).
 * - workdays: Monday–Friday.
 * - monthly: on day `day` (1–31) of every month; a shorter month fires on its last day.
 * - yearly: every year on `month`/`day` (month 1–12); 29 February fires on 28 February in
 *   non-leap years.
 */
export type CalendarRule =
  | { type: "weekly"; days: number[] }
  | { type: "workdays" }
  | { type: "monthly"; day: number }
  | { type: "yearly"; month: number; day: number };

export type TimeSchedule =
  | { kind: "at"; date: string | null; time: string; rule?: CalendarRule }
  | { kind: "interval"; minutes: number; mode: CountMode; repeat: boolean };

/** Persisted runtime of one Time node (lives on the note, saved with the project). */
export interface TimeRuntime {
  /** Stable key of the last occurrence that produced a message (R8.6 duplicate guard). */
  lastFiredKey?: string;
  /** Interval start: wall-clock ms for "calendar"; for "app"/"active" the counted ms so far. */
  intervalStartedAt?: number;
  countedMs?: number;
  /** Last wall-clock ms the scheduler looked at this node (sleep / restart / clock-change detection). */
  lastCheckedAt?: number;
}

/**
 * R8.8 session modes added: "session" = since hive was started this time; "taskCreated" = since the
 * linked task (strong Task → Time) was created ("how long I have not been doing it"); "taskDone" =
 * since that task was completed (shows no value while it is open).
 */
export type StopwatchMode = "project" | "node" | "active" | "app" | "manual" | "session" | "taskCreated" | "taskDone";

export interface StopwatchData {
  mode: StopwatchMode;
  /** Optional modes 3/4 can count from project creation instead of the Time node's creation. */
  includeProjectTime?: boolean;
  /** Whether the manual stopwatch is currently running. */
  running?: boolean;
  /** Accumulated manual stopwatch time, excluding a live run segment. */
  elapsedMs?: number;
  /** Start of the current manual run segment. */
  startedAt?: number;
  /** Project counters captured once when this Time node was first initialized. */
  nodeCreatedAppMs?: number;
  nodeCreatedActiveMs?: number;
}

export interface ProjectTimeCounters {
  appMs: number;
  activeMs: number;
}

export interface TimeNodeData {
  schedule: TimeSchedule;
  /** Off = no waiting at all (a stopped task, a user switch, an archived task until resumed). */
  enabled: boolean;
  runtime?: TimeRuntime;
  /** R8.4: what completing a linked task does. Only "stop" exists for now (absent = "stop"). */
  taskMode?: "stop" | "restart";
  /** Absent means the default Time view. */
  view?: "time" | "stopwatch";
  stopwatch?: StopwatchData;
}

/** Message cards stay until closed; old autoHideSeconds values are ignored on load. */
export interface MessageNodeData {
  sound: boolean;
  overhive: boolean;
}

/** One shown message card in the top-right queue. */
export interface ShownMessage {
  id: string;
  /** Time node that fired, and the Message node it went to (null = Time without a Message: shows the Time's name). */
  timeId: string;
  messageId: string | null;
  text: string;
  /** Wall-clock ms the occurrence was due, and when it was shown. */
  dueAt: number;
  shownAt: number;
  /** R8.6: shown late after sleep/restart (only the last missed occurrence is shown). */
  overlate: boolean;
  sound: boolean;
  /** A linked Task takes precedence over Message/Time for explicit navigation. */
  targetId?: string;
  importance?: import("../model/note").ImportanceLevel | null;
  headerHidden?: boolean;
  overhive?: boolean;
}
