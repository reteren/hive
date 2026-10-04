import { ME_POSITION } from "../board/camera.svelte";
import { board, updateNote } from "../model/board.svelte";
import { ME_OBJECT_ID } from "../model/link";
import { BEACON_SIZE } from "../model/note";
import { zoneBounds, type Zone, type ZoneBounds } from "../model/zone";
import { zones } from "../model/zones.svelte";
import { noteBounds } from "../notes/layout.svelte";
import { zoneAreaInRect, zoneTouchesRect } from "./geometry";

const AREA_EPS = 1e-8;
const tieChoices = new Map<string, string>();
const boundsCache = new WeakMap<Zone, { parts: Zone["parts"]; bounds: ZoneBounds }>();
let lastNotesRecord = board.notes;
let started = false;
let batchDepth = 0;

/** Select by occupied area; a boundary-only touch has area zero but still qualifies. */
export function chooseZoneForBounds(
  bounds: ZoneBounds,
  candidates: readonly Zone[],
  previousId: string | null = null,
  random: () => number = Math.random,
): string | null {
  const touching: Array<{ id: string; area: number }> = [];
  for (const zone of candidates) {
    if (!boundsTouch(boundsForZone(zone), bounds)) continue;
    const area = zoneAreaInRect(zone, bounds);
    if (area > AREA_EPS || zoneTouchesRect(zone, bounds)) touching.push({ id: zone.id, area });
  }
  if (touching.length === 0) return null;
  const maximum = Math.max(...touching.map((candidate) => candidate.area));
  const tied = touching.filter((candidate) => Math.abs(candidate.area - maximum) <= AREA_EPS);
  if (previousId && tied.some((candidate) => candidate.id === previousId)) return previousId;
  return tied[Math.min(tied.length - 1, Math.floor(Math.max(0, random()) * tied.length))].id;
}

function availableZones(): Zone[] {
  return zones.order.flatMap((id) => zones.byId[id] ? [zones.byId[id]] : []);
}

function syncIdentity(): void {
  if (lastNotesRecord === board.notes) return;
  tieChoices.clear();
  lastNotesRecord = board.notes;
}

function membershipFor(objectId: string, candidates = availableZones()): string | null {
  syncIdentity();
  const note = board.notes[objectId];
  if (batchDepth > 0) return note?.zoneId ?? tieChoices.get(objectId) ?? null;
  const half = BEACON_SIZE / 2;
  // ME occupies a fixed 7.2 u box at the origin, like a beacon note. Drawings are excluded.
  const bounds = objectId === ME_OBJECT_ID
    ? { x: ME_POSITION.x - half, y: ME_POSITION.y - half, width: BEACON_SIZE, height: BEACON_SIZE }
    : note ? noteBounds(note) : null;
  if (!bounds) return null;
  const previous = note?.zoneId ?? tieChoices.get(objectId) ?? null;
  const selected = chooseZoneForBounds(bounds, candidates, previous);
  if (selected) tieChoices.set(objectId, selected);
  else tieChoices.delete(objectId);
  return selected;
}

/** Current zone of any note kind, beacon, or the permanent ME beacon. */
export function zoneOf(objectId: string): string | null {
  return membershipFor(objectId);
}

/** Objects currently touching the zone, excluding drawings. */
export function zoneMembers(zoneId: string): string[] {
  if (!zones.byId[zoneId]) return [];
  const candidates = availableZones();
  return [...board.order, ME_OBJECT_ID].filter((id) => membershipFor(id, candidates) === zoneId);
}

/** Derived memory is updated only when membership changes, never as a history command. */
export function recomputeZoneMembership(): void {
  if (batchDepth > 0) {
    trackMembershipInputs();
    return;
  }
  const candidates = availableZones();
  // Only objects whose bounds changed need a new answer while the zones stay the same; a drag used to
  // recompute every note × zone pair on every pointer move.
  const zonesChanged = candidates.length !== lastZoneShapes.length ||
    candidates.some((zone, index) => lastZoneShapes[index]?.parts !== zone.parts || lastZoneShapes[index]?.holes !== zone.holes || lastZoneShapes[index]?.id !== zone.id);
  if (zonesChanged || lastResolvedRecord !== board.notes) {
    resolved.clear();
    lastZoneShapes = candidates.map((zone) => ({ id: zone.id, parts: zone.parts, holes: zone.holes }));
    lastResolvedRecord = board.notes;
  }
  for (const note of Object.values(board.notes)) {
    const bounds = noteBounds(note);
    const key = `${bounds.x},${bounds.y},${bounds.width},${bounds.height}`;
    const previous = resolved.get(note.id);
    if (previous && previous.key === key && previous.zoneId === (note.zoneId ?? null)) continue;
    const next = membershipFor(note.id, candidates);
    resolved.set(note.id, { key, zoneId: next });
    if ((note.zoneId ?? null) !== next) updateNote(note.id, { zoneId: next });
  }
  membershipFor(ME_OBJECT_ID, candidates);
}

const resolved = new Map<string, { key: string; zoneId: string | null }>();
let lastZoneShapes: { id: string; parts: Zone["parts"]; holes: Zone["holes"] }[] = [];
let lastResolvedRecord = board.notes;

/** Keep auto-zone membership stable while a zone drag previews; resolve it once when it ends. */
export function beginZoneMembershipBatch(): void {
  if (batchDepth === 0) recomputeZoneMembership();
  batchDepth += 1;
}

export function endZoneMembershipBatch(): void {
  if (batchDepth === 0) return;
  batchDepth -= 1;
  if (batchDepth === 0) {
    recomputeZoneMembership();
  }
}

/** Subscribe once; coordinate, measured-height, and zone changes all recompute membership. */
export function startZoneMembershipSync(): void {
  if (started) return;
  started = true;
  $effect.root(() => {
    $effect(() => {
      recomputeZoneMembership();
    });
  });
}

function boundsForZone(zone: Zone): ZoneBounds {
  const cached = boundsCache.get(zone);
  if (cached?.parts === zone.parts) return cached.bounds;
  const bounds = zoneBounds(zone);
  boundsCache.set(zone, { parts: zone.parts, bounds });
  return bounds;
}

function trackMembershipInputs(): void {
  for (const note of Object.values(board.notes)) noteBounds(note);
  for (const zone of availableZones()) {
    void zone.parts;
    void zone.holes;
  }
}

function boundsTouch(first: ZoneBounds, second: ZoneBounds): boolean {
  return first.x <= second.x + second.width && second.x <= first.x + first.width &&
    first.y <= second.y + second.height && second.y <= first.y + first.height;
}
