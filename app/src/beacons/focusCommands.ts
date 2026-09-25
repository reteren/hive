import { getCommand, registerCommand } from "../commands/registry.svelte";
import { formatKey } from "../commands/keys";
import { registerNoteMenuItem } from "../notes/noteMenu";
import { beaconState } from "./beaconState.svelte";
import { clearFocus, isBeacon, selectBeaconGroups, setFocused, toggleSelectedFocus, validFocused } from "./focus.svelte";
import { isMarked, markSelectedOnly, toggleBeaconMark, toggleSelectedMarks } from "./marks.svelte";

function keyLabel(commandId: string): string {
  const keys = getCommand(commandId)?.keys ?? [];
  return keys.length ? ` (${keys.map(formatKey).join(" / ")})` : "";
}

export function beaconMarkActionLabel(beaconId: string): string {
  return `${isMarked(beaconId) ? "Unmark" : "Mark"}${keyLabel("beacons.toggleMarkSelected")}`;
}

export function beaconFocusActionLabel(beaconId: string): string {
  return `${validFocused().includes(beaconId) ? "Exit focus" : "Focus"}${keyLabel("beacons.toggleFocus")}`;
}

export function focusBeaconFromMenu(beaconId: string): void {
  setFocused(beaconId, !validFocused().includes(beaconId));
}

registerCommand({
  id: "beacons.toggleFocus",
  label: "Focus selected beacon level",
  keys: ["Ctrl+KeyG"],
  run: toggleSelectedFocus,
  isActive: () => validFocused().length > 0,
});

registerCommand({
  id: "beacons.selectGroup",
  label: "Select beacon group",
  keys: ["Ctrl+KeyF"],
  run: selectBeaconGroups,
});

registerCommand({
  id: "beacons.menu",
  label: "Beacon menu",
  keys: ["Ctrl+KeyI"],
  run: () => { beaconState.menuOpen = !beaconState.menuOpen; },
  isActive: () => beaconState.menuOpen,
});

registerCommand({
  id: "beacons.mark",
  label: "Mark selected beacon",
  keys: ["KeyM"],
  run: markSelectedOnly,
});

registerCommand({
  id: "beacons.toggleMarkSelected",
  label: "Add or remove beacon mark",
  keys: ["Ctrl+KeyM"],
  run: toggleSelectedMarks,
});

registerCommand({
  id: "beacons.clearFocus",
  label: "Exit beacon focus",
  keys: [],
  run: clearFocus,
});

registerNoteMenuItem({
  id: "beacons.toggleMark",
  label: beaconMarkActionLabel,
  run: toggleBeaconMark,
  visible: isBeacon,
  order: 12,
});

registerNoteMenuItem({
  id: "beacons.toggleFocus",
  label: beaconFocusActionLabel,
  run: focusBeaconFromMenu,
  visible: isBeacon,
  order: 13,
});
