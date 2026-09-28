import { afterEach, describe, expect, it } from "vitest";
import { camera, viewport } from "../src/board/camera.svelte";
import { boardPopupPlacement, screenAnchoredPopupStyle } from "../src/ui/boardAnchor";
import { creationMenu, toggleCreationMenuPin } from "../src/notes/creation.svelte";

describe("create menu pinning", () => {
  afterEach(() => {
    camera.x = 0;
    camera.y = 0;
    camera.zoom = 1;
    viewport.width = 0;
    viewport.height = 0;
    creationMenu.pinned = false;
    creationMenu.menuAnchor = { x: 0, y: 0 };
    creationMenu.pinnedScreenAnchor = { x: 0, y: 0 };
    creationMenu.zoomAtOpen = 1;
  });

  it("captures the current screen location while pinned and resumes board anchoring when unpinned", () => {
    camera.x = 3;
    camera.y = -4;
    camera.zoom = 1.5;
    viewport.width = 900;
    viewport.height = 700;
    creationMenu.pinned = false;
    creationMenu.menuAnchor = { x: 18, y: 7 };
    creationMenu.zoomAtOpen = 1.5;

    toggleCreationMenuPin();
    const pinnedAnchor = { ...creationMenu.pinnedScreenAnchor };
    const pinnedStyle = screenAnchoredPopupStyle(pinnedAnchor);

    expect(creationMenu.pinned).toBe(true);
    expect(boardPopupPlacement(camera, viewport, creationMenu.menuAnchor, 1.5)).toMatchObject(pinnedAnchor);

    camera.x = 80;
    camera.y = 45;
    camera.zoom = 0.75;
    expect(screenAnchoredPopupStyle(creationMenu.pinnedScreenAnchor)).toBe(pinnedStyle);

    toggleCreationMenuPin();

    expect(creationMenu.pinned).toBe(false);
    expect(boardPopupPlacement(camera, viewport, creationMenu.menuAnchor, creationMenu.zoomAtOpen))
      .toEqual({ x: pinnedAnchor.x, y: pinnedAnchor.y, scale: 1 });
  });
});
