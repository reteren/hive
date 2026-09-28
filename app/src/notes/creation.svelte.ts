import { camera, pointer, viewport } from "../board/camera.svelte";
import { screenToWorld, worldToScreen } from "../board/cameraMath";
import { chooseCreationOrigin, type CreationTrigger } from "./creationPosition";
import { fitBoardPopupAnchor } from "../ui/boardAnchor";

export const creationMenu = $state({
  open: false,
  pinned: false,
  origin: { x: 0, y: 0 },
  screenAnchor: { x: 0, y: 0 },
  menuAnchor: { x: 0, y: 0 },
  pinnedScreenAnchor: { x: 0, y: 0 },
  zoomAtOpen: 1,
  pendingTrigger: null as CreationTrigger | null,
});

export function markCreationMenuToolbarTrigger(): void {
  creationMenu.pendingTrigger = "toolbar";
}

export function openCreationMenu(trigger: CreationTrigger): void {
  const origin = chooseCreationOrigin(trigger, pointer.world, camera, viewport);
  creationMenu.origin = origin.world;
  creationMenu.screenAnchor = origin.screen;
  creationMenu.zoomAtOpen = camera.zoom;
  creationMenu.menuAnchor = fitBoardPopupAnchor(camera, viewport, origin.world, { width: 164, height: 430 });
  creationMenu.pinned = false;
  creationMenu.open = true;
}

export function closeCreationMenu(): void {
  creationMenu.open = false;
  creationMenu.pinned = false;
  creationMenu.pendingTrigger = null;
}

export function toggleCreationMenuPin(): void {
  if (creationMenu.pinned) {
    creationMenu.menuAnchor = screenToWorld(camera, viewport, creationMenu.pinnedScreenAnchor);
    creationMenu.zoomAtOpen = camera.zoom;
    creationMenu.pinned = false;
    return;
  }

  creationMenu.pinnedScreenAnchor = worldToScreen(camera, viewport, creationMenu.menuAnchor);
  creationMenu.pinned = true;
}

export function creationMenuTrigger(): CreationTrigger {
  const trigger = creationMenu.pendingTrigger ?? "keyboard";
  creationMenu.pendingTrigger = null;
  return trigger;
}
