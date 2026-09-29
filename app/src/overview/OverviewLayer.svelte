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
    const pressedKeys = new Set<string>();
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
        "[data-create-menu], [data-link-context-menu], [data-zone-menu], [data-beacon-menu], [data-beacon-editor], [data-note-menu]",
      );
    }

    function onKeyDown(event: KeyboardEvent): void {
      const isAlt = event.key === "Alt" || event.code === "AltLeft" || event.code === "AltRight";
      if (!isAlt) {
        pressedKeys.add(event.code || event.key);
        if (overview.active || activationFrame !== 0) cancelActivation();
        return;
      }
      if (event.repeat) return;

      altHeld = true;
      pressedKeys.add(event.code || event.key);
      if (!isAltOnlyCandidate(event) || pressedPointers.size !== 0 ||
        [...pressedKeys].some((code) => code !== "AltLeft" && code !== "AltRight" && code !== "Alt") ||
        !isIdle()) {
        cancelActivation();
        return;
      }

      if (activationFrame !== 0) cancelAnimationFrame(activationFrame);
      activationFrame = requestAnimationFrame(() => {
        activationFrame = 0;
        if (!altHeld || event.defaultPrevented || pressedPointers.size !== 0 || !isIdle() ||
          [...pressedKeys].some((code) => code !== "AltLeft" && code !== "AltRight" && code !== "Alt")) return;
        setOverviewActive(true);
      });
    }

    function onKeyUp(event: KeyboardEvent): void {
      pressedKeys.delete(event.code || event.key);
      if (event.key === "Alt" || event.code === "AltLeft" || event.code === "AltRight") cancelActivation();
    }

    function onPointerDown(event: PointerEvent): void {
      pressedPointers.add(event.pointerId);
      if (overview.active || activationFrame !== 0) cancelActivation();
    }

    function onPointerEnd(event: PointerEvent): void {
      pressedPointers.delete(event.pointerId);
    }

    function onBlur(): void {
      pressedKeys.clear();
      pressedPointers.clear();
      cancelActivation();
    }

    window.addEventListener("keydown", onKeyDown, true);
    window.addEventListener("keyup", onKeyUp, true);
    window.addEventListener("pointerdown", onPointerDown, true);
    window.addEventListener("pointerup", onPointerEnd, true);
    window.addEventListener("pointercancel", onPointerEnd, true);
    window.addEventListener("blur", onBlur);

    return () => {
      window.removeEventListener("keydown", onKeyDown, true);
      window.removeEventListener("keyup", onKeyUp, true);
      window.removeEventListener("pointerdown", onPointerDown, true);
      window.removeEventListener("pointerup", onPointerEnd, true);
      window.removeEventListener("pointercancel", onPointerEnd, true);
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
