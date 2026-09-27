import { registerCommand } from "../commands/registry.svelte";

export const mapOverlayState = $state({ open: false });

export function toggleMapOverlay(): void {
  mapOverlayState.open = !mapOverlayState.open;
}

export function closeMapOverlay(): void {
  mapOverlayState.open = false;
}

registerCommand({
  id: "map.toggleOverlay",
  label: "Open map",
  keys: ["Shift+KeyM"],
  run: toggleMapOverlay,
  isActive: () => mapOverlayState.open,
});
