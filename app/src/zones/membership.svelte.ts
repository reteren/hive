import { ME_POSITION } from "../board/camera.svelte";
import { board, updateNote } from "../model/board.svelte";
import { ME_OBJECT_ID } from "../model/link";
import { BEACON_SIZE } from "../model/note";
import type { Zone, ZoneBounds } from "../model/zone";
import { zones } from "../model/zones.svelte";
import { noteBounds } from "../notes/layout.svelte";
import { zoneAreaInRect, zoneTouchesRect } from "./geometry";

const AREA_EPS = 1e-8;
const tieChoices = new Map<string, string>();
let lastNotesRecord = board.notes;
let started = false;

/** Select by occupied area; a boundary-only touch has area zero but still qualifies. */
export function chooseZoneForBounds(
  bounds: ZoneBounds,
  candidates: readonly Zone[],
  previousId: string | null = null,
  random: () => number = Math.random,
): string | null {
  const touching = candidates.flatMap((zone) => zoneTouchesRect(zone, bounds)
    ? [{ id: zone.id, area: zoneAreaInRect(zone, bounds) }]
    : []);
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

function membershipFor(objectId: string): string | null {
  syncIdentity();
  const note = board.notes[objectId];
  const half = BEACON_SIZE / 2;
  // ME occupies a fixed 7.2 u box at the origin, like a beacon note. Drawings are excluded.
  const bounds = objectId === ME_OBJECT_ID
    ? { x: ME_POSITION.x - half, y: ME_POSITION.y - half, width: BEACON_SIZE, height: BEACON_SIZE }
    : note ? noteBounds(note) : null;
  if (!bounds) return null;
  const previous = note?.zoneId ?? tieChoices.get(objectId) ?? null;
  const selected = chooseZoneForBounds(bounds, availableZones(), previous);
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
  return [...board.order, ME_OBJECT_ID].filter((id) => membershipFor(id) === zoneId);
}

/** Derived memory is updated only when membership changes, never as a history command. */
export function recomputeZoneMembership(): void {
  for (const note of Object.values(board.notes)) {
    const next = membershipFor(note.id);
    if ((note.zoneId ?? null) !== next) updateNote(note.id, { zoneId: next });
  }
  membershipFor(ME_OBJECT_ID);
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
