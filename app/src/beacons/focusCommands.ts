import { registerCommand } from "../commands/registry.svelte";
import { beaconState } from "./beaconState.svelte";
import { clearFocus, selectBeaconGroups, toggleSelectedFocus, validFocused } from "./focus.svelte";
import { markSelected } from "./marks.svelte";

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
  run: () => markSelected(false),
});

registerCommand({
  id: "beacons.toggleMark",
  label: "Add or remove beacon mark",
  keys: ["Ctrl+KeyM"],
  run: () => markSelected(true),
});

registerCommand({
  id: "beacons.clearFocus",
  label: "Exit beacon focus",
  keys: [],
  run: clearFocus,
});
