/**
 * Zone membership (R4.3): an object belongs to the zone it touches (M001); if it touches several,
 * the one covering the larger part of it (M002); on an exact tie the previous zone (note.zoneId)
 * wins, otherwise one is picked once and kept (H19). Implemented by the zones worker.
 */
export function zoneOf(_objectId: string): string | null {
  return null;
}

/** Objects currently belonging to a zone (notes of every kind, beacons). */
export function zoneMembers(_zoneId: string): string[] {
  return [];
}
