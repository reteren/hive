/**
 * Beacon coverage (R4.1): every object reachable from a beacon through STRONG outgoing links,
 * each visited once (cycles are safe). Weak links never create descendants. Implemented by the
 * beacons worker; others (focus, stats, progress) only call it.
 */
export function beaconDescendants(_beaconId: string): Set<string> {
  return new Set();
}
