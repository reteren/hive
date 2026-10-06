<script lang="ts">
  import { camera, viewport, ME_POSITION } from "./camera.svelte";
  import { pixelsPerUnit, worldToScreen } from "./cameraMath";
  import { isDimmed } from "../beacons/focus.svelte";
  import { isMarked } from "../beacons/marks.svelte";
  import { zoneOf } from "../zones/membership.svelte";
  import { zones } from "../model/zones.svelte";
  import { hasMeBeacon } from "../beacons/beaconState.svelte";
  import { deleteMeBeacon } from "../trash/trashActions.svelte";

  const screen = $derived(worldToScreen(camera, viewport, ME_POSITION));
  // A beacon has a fixed size on the board, like a note: it scales together with the camera zoom.
  const scale = $derived(pixelsPerUnit(camera) / 10);
  const memberZone = $derived(zones.byId[zoneOf("me") ?? ""]);

  function onBeaconKeydown(event: KeyboardEvent): void {
    if (event.key !== "Delete" && event.key !== "Backspace") return;
    event.preventDefault();
    event.stopPropagation();
    deleteMeBeacon();
  }
</script>

{#if hasMeBeacon()}
<div class="me" data-dimmed={isDimmed("me")} data-member-zone-id={memberZone?.id} style:transform={`translate(${screen.x}px, ${screen.y}px) scale(${scale})`}>
  <button class="dot" class:in-zone={Boolean(memberZone)} style:--zone-color={memberZone?.color ?? "transparent"} data-beacon-id="me" type="button" aria-label="ME beacon; press Delete to move to trash" onkeydown={onBeaconKeydown}></button>
  {#if isMarked("me")}<span class="mark" aria-label="Marked beacon"></span>{/if}
  <span class="label">ME</span>
</div>
{/if}

<style>
  /* Sizes below are at zoom 1 (1 u = 10 px): the dot is 7.2 u across (beacon size). */
  .me {
    position: absolute;
    left: 0;
    top: 0;
    transform-origin: 0 0;
    pointer-events: none;
  }

  .dot {
    position: absolute;
    left: -36px;
    top: -36px;
    width: 72px;
    height: 72px;
    border-radius: 50%;
    background: var(--accent);
    box-shadow: 0 0 0 12px rgba(var(--accent-rgb), 0.25);
    pointer-events: auto;
    cursor: crosshair;
    padding: 0;
    border: 0;
  }

  .label {
    position: absolute;
    left: 46px;
    top: -30px;
    color: var(--accent);
    font-size: 40px;
    font-weight: 600;
    letter-spacing: 0.04em;
    white-space: nowrap;
  }

  .dot.in-zone {
    outline: 3px solid var(--zone-color);
    outline-offset: 3px;
  }

  .mark {
    position: absolute;
    left: 26px;
    top: -38px;
    width: 14px;
    height: 14px;
    border: 2px solid var(--bg-board);
    border-radius: 50%;
    background: var(--accent);
  }
</style>
