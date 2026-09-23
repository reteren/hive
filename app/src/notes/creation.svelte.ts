import { camera, pointer, viewport } from "../board/camera.svelte";
import { chooseCreationOrigin, type CreationTrigger } from "./creationPosition";

export const creationMenu = $state({
  open: false,
  pinned: false,
  origin: { x: 0, y: 0 },
  screenAnchor: { x: 0, y: 0 },
  pendingTrigger: null as CreationTrigger | null,
});

export function markCreationMenuToolbarTrigger(): void {
  creationMenu.pendingTrigger = "toolbar";
}

export function openCreationMenu(trigger: CreationTrigger): void {
  const origin = chooseCreationOrigin(trigger, pointer.world, camera, viewport);
  creationMenu.origin = origin.world;
  creationMenu.screenAnchor = origin.screen;
  creationMenu.pinned = false;
  creationMenu.open = true;
}

export function closeCreationMenu(): void {
  creationMenu.open = false;
  creationMenu.pinned = false;
  creationMenu.pendingTrigger = null;
}

export function creationMenuTrigger(): CreationTrigger {
  const trigger = creationMenu.pendingTrigger ?? "keyboard";
  creationMenu.pendingTrigger = null;
  return trigger;
}
