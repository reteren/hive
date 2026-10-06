/**
 * Beacon view state (R4.2). "me" is the project-owned ME beacon; other beacons are notes of kind "beacon".
 * focused — beacons whose level is shown (Ctrl+G / Ctrl+I); marked — beacons marked with M (Ctrl for
 * several), visited in marking order by Space.
 */
export const beaconState = $state({
  meDeleted: false,
  focused: [] as string[],
  marked: [] as string[],
  menuOpen: false,
  markCursor: 0,
});

/** Called when opening a different project; marks may be restored from that project's data. */
export function resetBeaconViewState(marked: readonly string[] = [], meDeleted = false): void {
  beaconState.meDeleted = meDeleted;
  beaconState.focused = [];
  beaconState.marked = [...marked];
  beaconState.menuOpen = false;
  beaconState.markCursor = 0;
}

export function hasMeBeacon(): boolean {
  return !beaconState.meDeleted;
}
