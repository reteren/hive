<script lang="ts">
  import { onMount } from "svelte";
  import { invoke, isTauri } from "@tauri-apps/api/core";
  import { listen } from "@tauri-apps/api/event";
  import { isTextEditingTarget } from "../commands/focus";
  import { selection } from "../selection/selection.svelte";
  import { editing } from "../notes/editing.svelte";
  import { creationMenu } from "../notes/creation.svelte";
  import { linkContext } from "../links-in-text/contextMenu.svelte";
  import { beaconEditor } from "../beacons/beaconActions.svelte";
  import { zoneMode } from "../zones/zoneMode.svelte";
  import { camera } from "../board/camera.svelte";
  import { tool } from "../tools/tool.svelte";
  import { overview, setOverviewActive } from "./overview.svelte";
  import {
    beginAltOverviewGesture,
    consumeDrawAltWheel,
    endAltOverviewGesture,
    isAltOnlyCandidate,
    overviewTextFits,
    shouldShowAltOverview,
    type AltOverviewGesture,
  } from "./overviewLogic";

  $effect(() => {
    if (!overview.active) return;
    document.body.dataset.altOverviewText = overviewTextFits(72, 72, camera.zoom) ? "true" : "false";
  });

  const PAN_CODES = new Set(["KeyW", "KeyA", "KeyS", "KeyD"]);

  function isDrawOverlayControl(target: EventTarget | null): boolean {
    return target instanceof Element && target.closest("[data-draw-overlay-control]") !== null;
  }

  onMount(() => {
    const pressedPointers = new Set<number>();
    let altGesture: AltOverviewGesture = endAltOverviewGesture();
    let activationFrame = 0;

    function cancelActivation(): void {
      if (activationFrame !== 0) cancelAnimationFrame(activationFrame);
      activationFrame = 0;
      altGesture = endAltOverviewGesture();
      setOverviewActive(false);
    }

    /** Why the overview may not start right now, or null when the board is idle. */
    function idleBlocker(): string | null {
      if (editing.noteId !== null) return "editing a note";
      if (beaconEditor.noteId !== null) return "beacon editor";
      if (creationMenu.open) return "create menu open";
      if (linkContext.menu !== null) return "link menu open";
      if (selection.marquee !== null) return "marquee";
      if (selection.contextPick !== null) return "context pick";
      if (selection.grabActive) return "grab";
      if (zoneMode.active === "move") return "zone move";
      if (zoneMode.resizeZoneId !== null) return "zone resize";
      const activeElement = document.activeElement;
      const focusedDrawControl = tool.active === "draw" && isDrawOverlayControl(activeElement);
      if (isTextEditingTarget(activeElement) && !focusedDrawControl) return "text field focused";
      // Only real pop-up menus block. (The Mark as tag editor used to be listed here: it is part
      // of every Mark as node and open by default, so one Mark as on the board disabled Alt forever.)
      const open = document.querySelector(
        "[data-create-menu], [data-link-context-menu], [data-zone-menu], [data-beacon-menu], [data-beacon-editor], [data-note-menu], #grid-settings-popover, [data-module-picker], dialog[open]",
      );
      return open ? `open: ${open.tagName.toLowerCase()}${[...open.attributes].filter((a) => a.name.startsWith("data-")).map((a) => `[${a.name}]`).join("")}` : null;
    }

    function isIdle(): boolean {
      return idleBlocker() === null;
    }

    function diagnose(message: string): void {
      if (isTauri()) void invoke("log_overview", { message }).catch(() => undefined);
    }

    /** Lone Alt reported by the OS keyboard hook (the webview may never see a lone Alt). */
    function activateFromHook(): void {
      const blocker = pressedPointers.size !== 0 ? "mouse button held" : idleBlocker();
      if (blocker) {
        diagnose(`hook Alt down → blocked: ${blocker}`);
        return;
      }
      if (altGesture.held && altGesture.wheelConsumed) return;
      altGesture = beginAltOverviewGesture();
      setOverviewActive(true);
      diagnose("hook Alt down → overview on");
    }

    function onKeyDown(event: KeyboardEvent): void {
      const isAlt = event.key === "Alt" || event.code === "AltLeft" || event.code === "AltRight";
      // WASD pans the camera and must not end the overview (the user looks around with Alt held).
      if (!isAlt && PAN_CODES.has(event.code)) return;
      if (!isAlt) {
        if (overview.active || activationFrame !== 0) cancelActivation();
        return;
      }
      if (event.repeat) return;
      if (altGesture.held && altGesture.wheelConsumed) return;

      // Only the modifier state of THIS event counts: a remembered set of pressed keys goes stale
      // when a key-up never reaches the window (Space swallowed by the Inbox shortcut hook, Tab
      // after Alt+Tab) and then blocked the overview forever.
      if (!isAltOnlyCandidate(event) || pressedPointers.size !== 0 || !isIdle()) {
        cancelActivation();
        return;
      }

      altGesture = beginAltOverviewGesture();
      if (activationFrame !== 0) cancelAnimationFrame(activationFrame);
      // Switch immediately (no extra frame): the checks above already passed on this very key-down.
      setOverviewActive(true);
    }

    function onKeyUp(event: KeyboardEvent): void {
      if (event.key === "Alt" || event.code === "AltLeft" || event.code === "AltRight") cancelActivation();
    }

    function onPointerDown(event: PointerEvent): void {
      // Middle button = camera pan: allowed while looking at the overview.
      if (event.button === 1) return;
      const drawBoardTarget = tool.active === "draw" && event.target instanceof Element && event.target.closest(".board") !== null;
      pressedPointers.add(event.pointerId);
      if (overview.active && drawBoardTarget) {
        // This click dismisses the overview; do not also turn it into the first drawing gesture.
        event.preventDefault();
        event.stopImmediatePropagation();
      }
      if (overview.active || activationFrame !== 0) cancelActivation();
    }

    function onPointerEnd(event: PointerEvent): void {
      pressedPointers.delete(event.pointerId);
    }

    // A button released outside the window never sends pointerup here; the first move without
    // buttons proves nothing is pressed any more.
    function onPointerMove(event: PointerEvent): void {
      if (event.buttons === 0 && pressedPointers.size !== 0) pressedPointers.clear();
    }

    function onWheel(event: WheelEvent): void {
      const next = consumeDrawAltWheel(altGesture, tool.active === "draw", event);
      if (next === altGesture) return;
      altGesture = next;
      if (!overview.active || shouldShowAltOverview(altGesture)) return;
      setOverviewActive(false);
      diagnose("Alt + wheel in draw mode → overview off; brush opacity remains available");
    }

    function onBlur(): void {
      pressedPointers.clear();
      cancelActivation();
    }

    let unlistenHook: (() => void) | null = null;
    let disposed = false;
    if (isTauri()) {
      void listen<string>("hive://alt-overview", ({ payload }) => {
        if (payload === "down") activateFromHook();
        else cancelActivation();
      }).then((unlisten) => {
        if (disposed) unlisten();
        else unlistenHook = unlisten;
      }).catch((error: unknown) => diagnose(`could not listen to the keyboard hook: ${String(error)}`));
    }

    window.addEventListener("keydown", onKeyDown, true);
    window.addEventListener("keyup", onKeyUp, true);
    window.addEventListener("pointerdown", onPointerDown, true);
    window.addEventListener("pointerup", onPointerEnd, true);
    window.addEventListener("pointercancel", onPointerEnd, true);
    window.addEventListener("pointermove", onPointerMove, true);
    window.addEventListener("wheel", onWheel, true);
    window.addEventListener("blur", onBlur);

    return () => {
      disposed = true;
      unlistenHook?.();
      window.removeEventListener("keydown", onKeyDown, true);
      window.removeEventListener("keyup", onKeyUp, true);
      window.removeEventListener("pointerdown", onPointerDown, true);
      window.removeEventListener("pointerup", onPointerEnd, true);
      window.removeEventListener("pointercancel", onPointerEnd, true);
      window.removeEventListener("pointermove", onPointerMove, true);
      window.removeEventListener("wheel", onWheel, true);
      window.removeEventListener("blur", onBlur);
      if (activationFrame !== 0) cancelAnimationFrame(activationFrame);
      setOverviewActive(false);
    };
  });
</script>

<span class="overview-input-layer" aria-hidden="true"></span>

<style>
  .overview-input-layer { display: none; }

  :global(body[data-alt-overview="true"] [data-draw-cursor]),
  :global(body[data-alt-overview="true"] [data-draw-reticle]),
  :global(body[data-alt-overview="true"] [data-brush-hint]),
  :global(body[data-alt-overview="true"] [data-eyedropper]) {
    visibility: hidden;
  }
</style>
