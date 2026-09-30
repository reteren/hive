import { isTauri } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { board, updateNote } from "../model/board.svelte";
import { links } from "../model/links.svelte";
import type { Note } from "../model/note";
import { pushMessage } from "../messages/messageQueue.svelte";
import { resolveMessageContent } from "../messages/resolution";
import { evaluateTime, startRuntime, type TimeContext } from "./scheduler";
import type { ProjectTimeCounters, TimeNodeData, TimeRuntime } from "./types";
import { advanceTimeCounters, linkedMessagesForTime, taskMessageHostsForTime } from "./runtimeLogic";

const TICK_MS = 1_000;
const RUNTIME_PERSIST_MS = 30_000;

/** App-wide counters are persisted in the view-settings file, never in project history. */
export const timeCounters = $state({ appMs: 0, activeMs: 0 });
/** Stopwatch counters are scoped to the currently open project and exclude closed-app time. */
export const projectStopwatch = $state({ createdAt: Date.now(), appMs: 0, activeMs: 0 });
/** First runtime start in this process; never saved with a project. */
export const sessionStopwatch = $state({ startedAt: null as number | null });
/** Persistence observes this low-frequency revision instead of saving the board every tick. */
export const projectCounterSave = $state({ revision: 0 });

/**
 * The cache is valid only for the exact `time` object it was derived from: notes are updated in
 * place, so comparing the note would keep a stale runtime after an Undo or any external edit.
 */
interface CachedRuntime {
  time: TimeNodeData;
  runtime: TimeRuntime;
}

let intervalId: number | null = null;
let cleanupRuntime: (() => void) | null = null;
let focusUnlisten: (() => void) | null = null;
let lastTickAt = 0;
let lastRuntimePersistAt = 0;
let wasFocused = false;
let tauriFocused: boolean | null = null;
let runtimeByNoteId = new Map<string, CachedRuntime>();
let projectCreatedAtSnapshot = projectStopwatch.createdAt;
let projectCounterSnapshot: ProjectTimeCounters = { appMs: 0, activeMs: 0 };

export function setTimeCounters(value: { appMs: number; activeMs: number }): void {
  timeCounters.appMs = nonNegative(value.appMs);
  timeCounters.activeMs = nonNegative(value.activeMs);
}

/** Load one project's saved stopwatch epoch and app/focus counters. */
export function setProjectStopwatchData(createdAt: number, counters: ProjectTimeCounters): void {
  if (cleanupRuntime && lastTickAt > 0) accrueUntil(Date.now());
  projectCreatedAtSnapshot = nonNegative(createdAt);
  projectCounterSnapshot = { appMs: nonNegative(counters.appMs), activeMs: nonNegative(counters.activeMs) };
  projectStopwatch.createdAt = projectCreatedAtSnapshot;
  projectStopwatch.appMs = projectCounterSnapshot.appMs;
  projectStopwatch.activeMs = projectCounterSnapshot.activeMs;
  projectCounterSave.revision += 1;
}

/** Plain snapshot used by the project serializer without subscribing to each timer tick. */
export function currentProjectStopwatchData(): { createdAt: number; projectCounters: ProjectTimeCounters } {
  if (cleanupRuntime && lastTickAt > 0) accrueUntil(Date.now());
  return {
    createdAt: projectCreatedAtSnapshot,
    projectCounters: { ...projectCounterSnapshot },
  };
}

/** Start the main-window timer once and return a disposer for tests/lifecycle cleanup. */
export function startTimeRuntime(): () => void {
  if (cleanupRuntime) return cleanupRuntime;

  lastTickAt = Date.now();
  sessionStopwatch.startedAt ??= lastTickAt;
  lastRuntimePersistAt = lastTickAt;
  wasFocused = windowHasFocus();

  const onDocumentFocus = () => syncFocus();
  document.addEventListener("focus", onDocumentFocus);
  document.addEventListener("blur", onDocumentFocus);
  document.addEventListener("visibilitychange", onDocumentFocus);

  intervalId = window.setInterval(() => tick(), TICK_MS);

  if (isTauri()) {
    const currentWindow = getCurrentWindow();
    void currentWindow.onFocusChanged(({ payload }) => {
      tauriFocused = payload;
      syncFocus();
    }).then((unlisten) => {
      if (cleanupRuntime === null) unlisten();
      else focusUnlisten = unlisten;
    }).catch((error: unknown) => {
      console.warn("Could not observe the Hive window focus for Time counters.", error);
    });
    void currentWindow.isFocused().then((focused) => {
      if (tauriFocused === null) {
        tauriFocused = focused;
        syncFocus();
      }
    }).catch((error: unknown) => {
      console.warn("Could not read the Hive window focus for Time counters.", error);
    });
  }

  cleanupRuntime = () => {
    if (intervalId !== null) window.clearInterval(intervalId);
    intervalId = null;
    focusUnlisten?.();
    focusUnlisten = null;
    document.removeEventListener("focus", onDocumentFocus);
    document.removeEventListener("blur", onDocumentFocus);
    document.removeEventListener("visibilitychange", onDocumentFocus);
    cleanupRuntime = null;
    runtimeByNoteId.clear();
  };
  return cleanupRuntime;
}

/** Reset a Time node's wait from its current schedule without recording Undo history. */
export function restartTimeNode(noteId: string): void {
  const note = board.notes[noteId];
  if (!note?.time) return;
  const now = Date.now();
  const runtime = startRuntime(note.time.schedule, timeContext(now));
  const time = { ...note.time, runtime };
  updateNote(noteId, { time });
  rememberRuntime(noteId, runtime);
}

function tick(): void {
  const now = Date.now();
  accrueUntil(now);
  wasFocused = windowHasFocus();

  const context = timeContext(now);
  const liveTimeIds = new Set<string>();
  for (const noteId of board.order) {
    const note = board.notes[noteId];
    if (!note?.time || !note.time.enabled) continue;
    liveTimeIds.add(noteId);

    const cached = runtimeByNoteId.get(noteId);
    const priorRuntime = cached?.time === note.time ? cached.runtime : note.time.runtime ?? {};
    const result = evaluateTime({ ...note.time, runtime: priorRuntime }, context);
    runtimeByNoteId.set(noteId, { time: note.time, runtime: result.runtime });

    if (result.fire) {
      persistRuntime(note, result.runtime);
      showTimeFire(note, result.fire);
    }
  }

  for (const noteId of runtimeByNoteId.keys()) {
    if (!liveTimeIds.has(noteId)) runtimeByNoteId.delete(noteId);
  }

  if (now - lastRuntimePersistAt >= RUNTIME_PERSIST_MS) {
    persistCheckedRuntimes(liveTimeIds);
    projectCounterSave.revision += 1;
    lastRuntimePersistAt = now;
  }
}

function syncFocus(): void {
  const now = Date.now();
  accrueUntil(now);
  wasFocused = windowHasFocus();
}

function accrueUntil(now: number): void {
  const advanced = advanceTimeCounters(timeCounters, lastTickAt, now, wasFocused);
  projectCounterSnapshot = advanceTimeCounters(projectCounterSnapshot, lastTickAt, now, wasFocused).counters;
  timeCounters.appMs = advanced.counters.appMs;
  timeCounters.activeMs = advanced.counters.activeMs;
  projectStopwatch.appMs = projectCounterSnapshot.appMs;
  projectStopwatch.activeMs = projectCounterSnapshot.activeMs;
  lastTickAt = advanced.lastAt;
}

function windowHasFocus(): boolean {
  return document.hasFocus() && document.visibilityState !== "hidden" && (tauriFocused ?? true);
}

function timeContext(now: number): TimeContext {
  return { now, appMs: timeCounters.appMs, activeMs: timeCounters.activeMs };
}

function persistRuntime(note: Note, runtime: TimeRuntime): void {
  if (!note.time) return;
  const nextRuntime = { ...runtime };
  updateNote(note.id, { time: { ...note.time, runtime: nextRuntime } });
  rememberRuntime(note.id, nextRuntime);
}

function rememberRuntime(noteId: string, runtime: TimeRuntime): void {
  const time = board.notes[noteId]?.time;
  if (time) runtimeByNoteId.set(noteId, { time, runtime });
}

function persistCheckedRuntimes(ids: ReadonlySet<string>): void {
  for (const noteId of ids) {
    const note = board.notes[noteId];
    const cached = runtimeByNoteId.get(noteId);
    if (note?.time && cached?.time === note.time) {
      persistRuntime(note, cached.runtime);
    }
  }
}

function showTimeFire(note: Note, fire: { dueAt: number; overlate: boolean }): void {
  const edges = Object.values(links.byId);
  const recipients = linkedMessagesForTime(note.id, board.notes, edges);
  if (recipients.length === 0) {
    const taskMessageHosts = taskMessageHostsForTime(note.id, board.notes, edges);
    const embeddedHost = note.time ? note : taskMessageHosts[0];
    if (embeddedHost && (embeddedHost.message || embeddedHost.type === "message")) {
      pushMessage({
        timeId: note.id,
        messageId: embeddedHost.id,
        dueAt: fire.dueAt,
        overlate: fire.overlate,
        ...resolveMessageContent(embeddedHost, board.notes, edges, []),
      });
      return;
    }
    if (note.time && note.type !== "time") {
      pushMessage({
        timeId: note.id,
        messageId: null,
        dueAt: fire.dueAt,
        overlate: fire.overlate,
        ...resolveMessageContent(note, board.notes, edges, []),
      });
      return;
    }
    pushMessage({
      timeId: note.id,
      messageId: null,
      text: note.name,
      dueAt: fire.dueAt,
      overlate: fire.overlate,
      sound: false,
    });
    return;
  }

  for (const recipient of recipients) {
    pushMessage({
      timeId: note.id,
      messageId: recipient.id,
      dueAt: fire.dueAt,
      overlate: fire.overlate,
      ...resolveMessageContent(recipient, board.notes, Object.values(links.byId), board.order),
    });
  }
}

function nonNegative(value: number): number {
  return Number.isFinite(value) ? Math.max(0, value) : 0;
}
