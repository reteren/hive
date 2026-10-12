import { ME_POSITION } from "../board/camera.svelte";
import { queryRect } from "../board/visibility.svelte";
import { board, onBoardMutation, updateNote } from "../model/board.svelte";
import { ME_OBJECT_ID } from "../model/link";
import { hasMeBeacon } from "../beacons/beaconState.svelte";
import { BEACON_SIZE } from "../model/note";
import { zoneBounds, type Zone, type ZoneBounds } from "../model/zone";
import { onZonesMutation, zones } from "../model/zones.svelte";
import { noteBounds } from "../notes/layout.svelte";
import { ZoneBoundsIndex } from "./zoneBoundsIndex";
import { zoneAreaInRect, zoneTouchesRect } from "./geometry";

const AREA_EPS = 1e-8;
const zoneIndex = new ZoneBoundsIndex();
const resolved = new Map<string, { key: string; zoneId: string | null }>();
const membersByZone = new Map<string, Set<string>>();
const orderByNote = new Map<string, number>();
const dirtyIds = new Set<string>();
const forceDirtyIds = new Set<string>();
const writingMembership = new Set<string>();
const tieChoices = new Map<string, string>();
const zoneBoundsCache = new WeakMap<Zone, { parts: Zone["parts"]; bounds: ZoneBounds }>();
const membershipState: { version: number } = $state({ version: 0 });
const zoneIndexState: { version: number } = $state({ version: 0 });
let zoneIndexReady = false;
let dirtyAll = true;
let scheduled = false;
let batchDepth = 0;
let started = false;
let lastMePresence = hasMeBeacon();

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
  return tied[Math.min(tied.length - 1, Math.floor(Math.max(0, random()) * tied.length))]!.id;
}

/** Zone ids whose indexed bounds intersect a world rectangle; used by the overview layer. */
export function zoneIdsInRect(bounds: ZoneBounds): string[] {
  void zoneIndexState.version;
  ensureZoneIndex();
  return zoneIndex.query(bounds).map((zone) => zone.id);
}

/** Current zone of any note kind, beacon, or the permanent ME beacon. */
export function zoneOf(objectId: string): string | null {
  void membershipState.version;
  syncMePresence();
  const note = board.notes[objectId];
  if (objectId !== ME_OBJECT_ID && !note) return null;
  if (objectId === ME_OBJECT_ID && !hasMeBeacon()) {
    removeResolved(objectId);
    tieChoices.delete(objectId);
    return null;
  }
  if (batchDepth > 0) return resolved.get(objectId)?.zoneId ?? note?.zoneId ?? null;
  if (dirtyAll) recomputeZoneMembership();
  else if (dirtyIds.delete(objectId)) {
    resolveOne(objectId, forceDirtyIds.delete(objectId));
  }
  if (!resolved.has(objectId)) resolveOne(objectId);
  return resolved.get(objectId)?.zoneId ?? null;
}

/** Objects currently touching the zone, excluding drawings. */
export function zoneMembers(zoneId: string): string[] {
  void membershipState.version;
  ensureResolved();
  if (!zones.byId[zoneId]) return [];
  const members = [...(membersByZone.get(zoneId) ?? [])];
  members.sort((first, second) => (orderByNote.get(first) ?? Number.MAX_SAFE_INTEGER) -
    (orderByNote.get(second) ?? Number.MAX_SAFE_INTEGER));
  return members;
}

/** Resolve pending object ids, or all objects after a board/zone replacement. */
export function recomputeZoneMembership(ids?: readonly string[]): void {
  if (batchDepth > 0) return;
  syncMePresence();
  ensureZoneIndex();
  if (ids) {
    for (const id of ids) resolveOne(id);
    return;
  }
  let forceMe = false;
  if (dirtyAll) {
    forceMe = true;
    dirtyAll = false;
    dirtyIds.clear();
    forceDirtyIds.clear();
    const currentIds = new Set(board.order);
    for (const [id] of resolved) {
      if (id !== ME_OBJECT_ID && !currentIds.has(id)) removeResolved(id);
    }
    for (const id of orderByNote.keys()) if (!currentIds.has(id)) orderByNote.delete(id);
    for (let index = 0; index < board.order.length; index += 1) {
      const id = board.order[index]!;
      orderByNote.set(id, index);
      resolveOne(id, true);
    }
  } else {
    for (const id of dirtyIds) resolveOne(id, forceDirtyIds.has(id));
    dirtyIds.clear();
    forceDirtyIds.clear();
  }
  if (hasMeBeacon()) resolveOne(ME_OBJECT_ID, forceMe || forceDirtyIds.delete(ME_OBJECT_ID));
  else removeResolved(ME_OBJECT_ID);
}

/** Keep auto-zone membership stable while a zone drag previews; resolve it once when it ends. */
export function beginZoneMembershipBatch(): void {
  if (batchDepth === 0) recomputeZoneMembership();
  batchDepth += 1;
}

export function endZoneMembershipBatch(): void {
  if (batchDepth === 0) return;
  batchDepth -= 1;
  if (batchDepth === 0) recomputeZoneMembership();
}

/** Start the reactive ME beacon watcher; note and zone work arrives through dirty-id listeners. */
export function startZoneMembershipSync(): void {
  if (started) return;
  started = true;
  ensureResolved();
  $effect.root(() => {
    $effect(() => {
      const present = hasMeBeacon();
      lastMePresence = present;
      if (present) resolveOne(ME_OBJECT_ID, true);
      else removeResolved(ME_OBJECT_ID);
    });
  });
}

onBoardMutation((ids) => {
  if (ids === null) {
    dirtyAll = true;
    dirtyIds.clear();
    rebuildNoteOrder();
  } else {
    for (const id of ids) {
      if (writingMembership.has(id)) {
        writingMembership.delete(id);
        continue;
      }
      dirtyIds.add(id);
      if (board.notes[id]) {
        if (!orderByNote.has(id)) rebuildNoteOrder();
      } else {
        orderByNote.delete(id);
        rebuildNoteOrder();
      }
    }
  }
  scheduleResolve();
});

onZonesMutation((ids, geometryChanged) => {
  if (!geometryChanged) return;
  if (ids === null) {
    rebuildZoneIndex();
    zoneIndexState.version += 1;
    dirtyAll = true;
    dirtyIds.clear();
    scheduleResolve();
    return;
  }
  if (!zoneIndexReady) {
    rebuildZoneIndex();
    zoneIndexState.version += 1;
    dirtyAll = true;
    scheduleResolve();
    return;
  }

  let changedBounds: ZoneBounds | null = null;
  let zoneSetChanged = false;
  for (const id of ids) {
    const oldBounds = zoneIndex.boundsOf(id);
    const zone = zones.byId[id];
    if (Boolean(oldBounds) !== Boolean(zone)) zoneSetChanged = true;
    if (zone) zoneIndex.update(zone, zones.order.indexOf(id));
    else zoneIndex.remove(id);
    const newBounds = zone ? zoneBounds(zone) : undefined;
    if (oldBounds) changedBounds = unionBounds(changedBounds, oldBounds);
    if (newBounds) changedBounds = unionBounds(changedBounds, newBounds);
  }
  if (zoneSetChanged) rebuildZoneIndex();
  zoneIndexState.version += 1;
  if (!changedBounds) {
    dirtyAll = true;
  } else {
    // Query only notes that could intersect the zone's old/new swept bounds.
    for (const id of queryRect(changedBounds)) {
      dirtyIds.add(id);
      forceDirtyIds.add(id);
    }
    dirtyIds.add(ME_OBJECT_ID);
    forceDirtyIds.add(ME_OBJECT_ID);
  }
  scheduleResolve();
});

function ensureResolved(): void {
  if (dirtyAll || dirtyIds.size > 0) recomputeZoneMembership();
}

function ensureZoneIndex(): void {
  if (!zoneIndexReady) rebuildZoneIndex();
}

function rebuildNoteOrder(): void {
  orderByNote.clear();
  for (let index = 0; index < board.order.length; index += 1) orderByNote.set(board.order[index]!, index);
}

function rebuildZoneIndex(): void {
  zoneIndex.rebuild(zones.order.flatMap((id) => zones.byId[id] ? [zones.byId[id]!] : []), zones.order);
  zoneIndexReady = true;
}

function scheduleResolve(): void {
  if (scheduled) return;
  scheduled = true;
  queueMicrotask(() => {
    scheduled = false;
    if (batchDepth === 0) recomputeZoneMembership();
  });
}

function resolveOne(objectId: string, force = false): void {
  ensureZoneIndex();
  if (objectId === ME_OBJECT_ID && !hasMeBeacon()) {
    removeResolved(objectId);
    tieChoices.delete(objectId);
    return;
  }
  const note = board.notes[objectId];
  if (objectId !== ME_OBJECT_ID && !note) {
    removeResolved(objectId);
    tieChoices.delete(objectId);
    return;
  }
  const half = BEACON_SIZE / 2;
  const bounds = objectId === ME_OBJECT_ID
    ? { x: ME_POSITION.x - half, y: ME_POSITION.y - half, width: BEACON_SIZE, height: BEACON_SIZE }
    : noteBounds(note!);
  const key = `${bounds.x},${bounds.y},${bounds.width},${bounds.height}`;
  const previous = resolved.get(objectId);
  if (!force && previous?.key === key && previous.zoneId === (note?.zoneId ?? null)) return;
  const previousId = note?.zoneId ?? previous?.zoneId ?? tieChoices.get(objectId) ?? null;
  const selected = chooseZoneForBounds(bounds, zoneIndex.query(bounds), previousId);
  if (selected) tieChoices.set(objectId, selected);
  else tieChoices.delete(objectId);
  setResolved(objectId, key, selected);
  if (note && (note.zoneId ?? null) !== selected) {
    writingMembership.add(objectId);
    updateNote(objectId, { zoneId: selected });
  }
}

function syncMePresence(): void {
  const present = hasMeBeacon();
  if (present === lastMePresence) return;
  lastMePresence = present;
  if (present) resolveOne(ME_OBJECT_ID, true);
  else removeResolved(ME_OBJECT_ID);
}

function boundsForZone(zone: Zone): ZoneBounds {
  const cached = zoneBoundsCache.get(zone);
  if (cached?.parts === zone.parts) return cached.bounds;
  const bounds = zoneBounds(zone);
  zoneBoundsCache.set(zone, { parts: zone.parts, bounds });
  return bounds;
}

function setResolved(objectId: string, key: string, zoneId: string | null): void {
  const previous = resolved.get(objectId);
  if (previous?.zoneId === zoneId && previous.key === key) return;
  if (previous?.zoneId) membersByZone.get(previous.zoneId)?.delete(objectId);
  resolved.set(objectId, { key, zoneId });
  if (zoneId) {
    let members = membersByZone.get(zoneId);
    if (!members) membersByZone.set(zoneId, members = new Set());
    members.add(objectId);
  }
  membershipState.version += 1;
}

function removeResolved(objectId: string): void {
  const previous = resolved.get(objectId);
  if (!previous) return;
  if (previous.zoneId) membersByZone.get(previous.zoneId)?.delete(objectId);
  resolved.delete(objectId);
  membershipState.version += 1;
}

function boundsTouch(first: ZoneBounds, second: ZoneBounds): boolean {
  return first.x <= second.x + second.width && second.x <= first.x + first.width &&
    first.y <= second.y + second.height && second.y <= first.y + first.height;
}

function unionBounds(current: ZoneBounds | null, next: ZoneBounds): ZoneBounds {
  if (!current) return { ...next };
  const x = Math.min(current.x, next.x);
  const y = Math.min(current.y, next.y);
  const right = Math.max(current.x + current.width, next.x + next.width);
  const bottom = Math.max(current.y + current.height, next.y + next.height);
  return { x, y, width: right - x, height: bottom - y };
}
