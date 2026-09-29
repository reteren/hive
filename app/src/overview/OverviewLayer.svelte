<script lang="ts">
  import { onMount } from "svelte";
  import { isTextEditingTarget } from "../commands/focus";
  import { selection } from "../selection/selection.svelte";
  import { editing } from "../notes/editing.svelte";
  import { creationMenu } from "../notes/creation.svelte";
  import { linkContext } from "../links-in-text/contextMenu.svelte";
  import { beaconEditor } from "../beacons/beaconActions.svelte";
  import { tool } from "../tools/tool.svelte";
  import { zoneMode } from "../zones/zoneMode.svelte";
  import { camera } from "../board/camera.svelte";
  import { overview, setOverviewActive } from "./overview.svelte";
  import { isAltOnlyCandidate, overviewTextFits } from "./overviewLogic";

  $effect(() => {
    if (!overview.active) return;
    document.body.dataset.altOverviewText = overviewTextFits(72, 72, camera.zoom) ? "true" : "false";
  });

  onMount(() => {
    const pressedPointers = new Set<number>();
    let altHeld = false;
    let activationFrame = 0;

    function cancelActivation(): void {
      if (activationFrame !== 0) cancelAnimationFrame(activationFrame);
      activationFrame = 0;
      altHeld = false;
      setOverviewActive(false);
    }

    function isIdle(): boolean {
      if (tool.active !== "select" || editing.noteId !== null || beaconEditor.noteId !== null ||
        creationMenu.open || linkContext.menu !== null || selection.marquee !== null ||
        selection.contextPick !== null || selection.grabActive || zoneMode.active === "move" ||
        zoneMode.resizeZoneId !== null || isTextEditingTarget(document.activeElement)) return false;
      return !document.querySelector(
        "[data-create-menu], [data-link-context-menu], [data-zone-menu], [data-beacon-menu], [data-beacon-editor], [data-note-menu], [data-markas-editor], #grid-settings-popover, [data-module-picker], dialog[open]",
      );
    }

    function onKeyDown(event: KeyboardEvent): void {
      const isAlt = event.key === "Alt" || event.code === "AltLeft" || event.code === "AltRight";
      if (!isAlt) {
        if (overview.active || activationFrame !== 0) cancelActivation();
        return;
      }
      if (event.repeat) return;

      altHeld = true;
      // Only the modifier state of THIS event counts: a remembered set of pressed keys goes stale
      // when a key-up never reaches the window (Space swallowed by the Inbox shortcut hook, Tab
      // after Alt+Tab) and then blocked the overview forever.
      if (!isAltOnlyCandidate(event) || pressedPointers.size !== 0 || !isIdle()) {
        cancelActivation();
        return;
      }

      if (activationFrame !== 0) cancelAnimationFrame(activationFrame);
      activationFrame = requestAnimationFrame(() => {
        activationFrame = 0;
        if (!altHeld || pressedPointers.size !== 0 || !isIdle()) return;
        setOverviewActive(true);
      });
    }

    function onKeyUp(event: KeyboardEvent): void {
      if (event.key === "Alt" || event.code === "AltLeft" || event.code === "AltRight") cancelActivation();
    }

    function onPointerDown(event: PointerEvent): void {
      pressedPointers.add(event.pointerId);
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

    function onBlur(): void {
      pressedPointers.clear();
      cancelActivation();
    }

    window.addEventListener("keydown", onKeyDown, true);
    window.addEventListener("keyup", onKeyUp, true);
    window.addEventListener("pointerdown", onPointerDown, true);
    window.addEventListener("pointerup", onPointerEnd, true);
    window.addEventListener("pointercancel", onPointerEnd, true);
    window.addEventListener("pointermove", onPointerMove, true);
    window.addEventListener("blur", onBlur);

    return () => {
      window.removeEventListener("keydown", onKeyDown, true);
      window.removeEventListener("keyup", onKeyUp, true);
      window.removeEventListener("pointerdown", onPointerDown, true);
      window.removeEventListener("pointerup", onPointerEnd, true);
      window.removeEventListener("pointercancel", onPointerEnd, true);
      window.removeEventListener("pointermove", onPointerMove, true);
      window.removeEventListener("blur", onBlur);
      if (activationFrame !== 0) cancelAnimationFrame(activationFrame);
      setOverviewActive(false);
    };
  });
</script>

<span class="overview-input-layer" aria-hidden="true"></span>

<style>
  .overview-input-layer { display: none; }
</style>
