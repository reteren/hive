/**
 * Beacon view state (R4.2). "me" is the permanent ME beacon; other beacons are notes of kind "beacon".
 * focused — beacons whose level is shown (Ctrl+G / Ctrl+I); marked — beacons marked with M (Ctrl for
 * several), visited in marking order by Space.
 */
export const beaconState = $state({
  focused: [] as string[],
  marked: [] as string[],
});
