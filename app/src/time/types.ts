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
export type TimeSchedule =
  | { kind: "at"; date: string | null; time: string }
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

export interface TimeNodeData {
  schedule: TimeSchedule;
  /** Off = no waiting at all (a stopped task, a user switch, an archived task until resumed). */
  enabled: boolean;
  runtime?: TimeRuntime;
  /** R8.4: what completing a linked task does. Only "stop" exists for now (absent = "stop"). */
  taskMode?: "stop" | "restart";
}

/** R8.5 Message node settings. The text is the note's own `text`. */
export interface MessageNodeData {
  sound: boolean;
  /** null = the card stays until closed (user decision 28.09 default). */
  autoHideSeconds: number | null;
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
  autoHideSeconds: number | null;
}
