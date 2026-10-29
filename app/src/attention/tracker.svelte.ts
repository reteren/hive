import { camera } from "../board/camera.svelte";
import { zones } from "../model/zones.svelte";
import { project } from "../project/project.svelte";
import { shapeContainsPoint } from "../zones/shape";
import {
  attentionDayKey,
  OUTSIDE_ZONES,
  parseAttentionLog,
  pruneAttention,
  recordAttention,
  type AttentionLog,
  type AttentionPeriod,
} from "./logic";

const LOG_KEY_PREFIX = "hive.attention.v1:";
const MAPS_KEY = "hive.attention.maps.v1";
const SAMPLE_MS = 1000;
const SAVE_EVERY_SAMPLES = 10;
/** No input for this long means the user stepped away; that time is not attention. */
const IDLE_MS = 90_000;

/**
 * Where the user looks on the board: the camera centre is sampled once a second while hive is
 * focused and in use. The log is local to this computer (localStorage per project folder), so it
 * never travels through a project's Git history.
 */
export const attention = $state({ revision: 0 });

/** Map nodes that show attention, with the period each one shows. Local, like the log. */
export const attentionMaps = $state<{ byId: Record<string, AttentionPeriod> }>({ byId: readMaps() });

let log: AttentionLog = {};
let loadedPath: string | null = null;
let unsaved = 0;
let lastActivity = Date.now();
let started = false;

function storage(): Storage | null {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

function readMaps(): Record<string, AttentionPeriod> {
  try {
    const raw = JSON.parse(storage()?.getItem(MAPS_KEY) ?? "{}") as Record<string, unknown>;
    return Object.fromEntries(Object.entries(raw).filter((entry): entry is [string, AttentionPeriod] =>
      entry[1] === "today" || entry[1] === "week" || entry[1] === "month" || entry[1] === "all"));
  } catch {
    return {};
  }
}

export function setAttentionMap(noteId: string, period: AttentionPeriod | null): void {
  if (period) attentionMaps.byId[noteId] = period;
  else delete attentionMaps.byId[noteId];
  try {
    storage()?.setItem(MAPS_KEY, JSON.stringify(attentionMaps.byId));
  } catch { /* the toggle still works for this session */ }
}

function saveLog(): void {
  if (!loadedPath || unsaved === 0) return;
  pruneAttention(log, new Date());
  try {
    storage()?.setItem(LOG_KEY_PREFIX + loadedPath, JSON.stringify(log));
  } catch { /* storage full or blocked: keep counting in memory */ }
  unsaved = 0;
}

function ensureLoaded(): void {
  const path = project.path;
  if (path === loadedPath) return;
  saveLog();
  loadedPath = path;
  try {
    log = path ? parseAttentionLog(JSON.parse(storage()?.getItem(LOG_KEY_PREFIX + path) ?? "{}")) : {};
  } catch {
    log = {};
  }
  attention.revision += 1;
}

export function attentionLog(): AttentionLog {
  ensureLoaded();
  return log;
}

export function zoneAtPoint(point: { x: number; y: number }): string {
  // Later zones draw on top, so the topmost one under the camera wins.
  for (let index = zones.order.length - 1; index >= 0; index -= 1) {
    const zone = zones.byId[zones.order[index]];
    if (zone && shapeContainsPoint(zone, point)) return zone.id;
  }
  return OUTSIDE_ZONES;
}

function sample(): void {
  ensureLoaded();
  if (!loadedPath || document.visibilityState !== "visible" || !document.hasFocus()) return;
  if (Date.now() - lastActivity > IDLE_MS) return;
  const point = { x: camera.x, y: camera.y };
  recordAttention(log, attentionDayKey(new Date()), point, zoneAtPoint(point), SAMPLE_MS / 1000);
  unsaved += 1;
  if (unsaved >= SAVE_EVERY_SAMPLES) {
    saveLog();
    attention.revision += 1;
  }
}

export function startAttentionTracking(): void {
  if (started || typeof window === "undefined") return;
  started = true;
  const markActive = () => { lastActivity = Date.now(); };
  for (const type of ["pointermove", "pointerdown", "keydown", "wheel"]) {
    window.addEventListener(type, markActive, { capture: true, passive: true });
  }
  window.setInterval(sample, SAMPLE_MS);
  window.addEventListener("pagehide", saveLog);
  window.addEventListener("beforeunload", saveLog);
}
