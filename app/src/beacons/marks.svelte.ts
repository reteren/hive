import { board } from "../model/board.svelte";
import { ME_OBJECT_ID } from "../model/link";
import { beaconState } from "./beaconState.svelte";
import { isBeacon, selectedBeacons } from "./focus.svelte";

/** Deleting a beacon drops it from the effective sequence; the next Space skips it. */
export function validMarks(): string[] {
  return beaconState.marked.filter(isBeacon);
}

export function isMarked(beaconId: string): boolean {
  return validMarks().includes(beaconId);
}

export function toggleSelectedMarks(): void {
  const ids = selectedBeacons();
  if (!ids.length) return;
  beaconState.marked = ids.reduce((marks, id) => marks.includes(id)
    ? marks.filter((value) => value !== id)
    : [...marks, id], validMarks());
  beaconState.markCursor = 0;
}

/** Toggle one beacon from a contextual menu without changing the current selection. */
export function toggleBeaconMark(beaconId: string): void {
  if (!isBeacon(beaconId)) return;
  const marks = validMarks();
  beaconState.marked = marks.includes(beaconId)
    ? marks.filter((id) => id !== beaconId)
    : [...marks, beaconId];
  beaconState.markCursor = 0;
}

/** Return the next target in marking order, or ME when none remain. */
export function nextMarkedBeacon(): string {
  const marks = beaconState.marked;
  if (!marks.some(isBeacon)) {
    beaconState.marked = [];
    beaconState.markCursor = 0;
    return ME_OBJECT_ID;
  }
  for (let offset = 0; offset < marks.length; offset += 1) {
    const index = (beaconState.markCursor + offset) % marks.length;
    const id = marks[index];
    if (!isBeacon(id)) continue;
    const remaining = marks.filter(isBeacon);
    beaconState.marked = remaining;
    beaconState.markCursor = (remaining.indexOf(id) + 1) % remaining.length;
    return id;
  }
  return ME_OBJECT_ID;
}

export function markedBeaconPoint(id: string): { x: number; y: number } {
  if (id === ME_OBJECT_ID) return { x: 0, y: 0 };
  const note = board.notes[id];
  return note ? { x: note.x + note.width / 2, y: note.y + (note.height ?? note.width) / 2 } : { x: 0, y: 0 };
}
