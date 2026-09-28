import { isTauri } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { board, updateNote } from "../model/board.svelte";
import { links } from "../model/links.svelte";
import type { Note } from "../model/note";
import { pushMessage } from "../messages/messageQueue.svelte";
import { evaluateTime, startRuntime, type TimeContext } from "./scheduler";
import type { TimeNodeData, TimeRuntime } from "./types";
import { advanceTimeCounters, linkedMessagesForTime } from "./runtimeLogic";

const TICK_MS = 1_000;
const RUNTIME_PERSIST_MS = 30_000;

/** App-wide counters are persisted in the view-settings file, never in project history. */
export const timeCounters = $state({ appMs: 0, activeMs: 0 });

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

export function setTimeCounters(value: { appMs: number; activeMs: number }): void {
  timeCounters.appMs = nonNegative(value.appMs);
  timeCounters.activeMs = nonNegative(value.activeMs);
}

/** Start the main-window timer once and return a disposer for tests/lifecycle cleanup. */
export function startTimeRuntime(): () => void {
  if (cleanupRuntime) return cleanupRuntime;

  lastTickAt = Date.now();
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
  if (note?.type !== "time" || !note.time) return;
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
    if (note?.type !== "time" || !note.time || !note.time.enabled) continue;
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
  timeCounters.appMs = advanced.counters.appMs;
  timeCounters.activeMs = advanced.counters.activeMs;
  lastTickAt = advanced.lastAt;
}

function windowHasFocus(): boolean {
  return document.hasFocus() && document.visibilityState !== "hidden" && (tauriFocused ?? true);
}

function timeContext(now: number): TimeContext {
  return { now, appMs: timeCounters.appMs, activeMs: timeCounters.activeMs };
}

function persistRuntime(note: Note, runtime: TimeRuntime): void {
  if (note.type !== "time" || !note.time) return;
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
    if (note?.type === "time" && note.time && cached?.time === note.time) {
      persistRuntime(note, cached.runtime);
    }
  }
}

function showTimeFire(note: Note, fire: { dueAt: number; overlate: boolean }): void {
  const recipients = linkedMessagesForTime(note.id, board.notes, Object.values(links.byId));
  if (recipients.length === 0) {
    pushMessage({
      timeId: note.id,
      messageId: null,
      text: note.name,
      dueAt: fire.dueAt,
      overlate: fire.overlate,
      sound: false,
      autoHideSeconds: null,
    });
    return;
  }

  for (const recipient of recipients) {
    pushMessage({
      timeId: note.id,
      messageId: recipient.id,
      text: recipient.text,
      dueAt: fire.dueAt,
      overlate: fire.overlate,
      sound: recipient.message?.sound ?? false,
      autoHideSeconds: recipient.message?.autoHideSeconds ?? null,
    });
  }
}

function nonNegative(value: number): number {
  return Number.isFinite(value) ? Math.max(0, value) : 0;
}
