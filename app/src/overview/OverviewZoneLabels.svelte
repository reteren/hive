<script lang="ts">
  import { camera, viewport } from "../board/camera.svelte";
  import { PX_PER_UNIT, worldToScreen } from "../board/cameraMath";
  import { zones } from "../model/zones.svelte";
  import { zoneBounds } from "../model/zone";
  import { overview } from "./overview.svelte";
  import { overviewZoneFontSize, overviewZoneLabel } from "./overviewLogic";

  // Zone labels of the Alt overview live in their own layer ABOVE the nodes (the zones themselves
  // stay below), so a node lying inside a zone never hides the zone's name.
  let labels = $derived(overview.active
    ? zones.order.flatMap((id) => {
      const zone = zones.byId[id];
      if (!zone) return [];
      const bounds = zoneBounds(zone);
      const size = overviewZoneFontSize(zone.name, bounds.width, bounds.height, camera.zoom);
      if (size === null) return [];
      const centre = worldToScreen(camera, viewport, { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 });
      return [{ id, text: overviewZoneLabel(zone.name), color: zone.color, x: centre.x, y: centre.y, px: size * PX_PER_UNIT * camera.zoom }];
    })
    : []);
</script>

{#if labels.length > 0}
  <div class="overview-zone-labels" aria-hidden="true">
    {#each labels as label (label.id)}
      <span
        class="overview-zone-label"
        data-overview-zone-label={label.id}
        style:left={`${label.x}px`}
        style:top={`${label.y}px`}
        style:font-size={`${label.px}px`}
        style:color={label.color}
      >{label.text}</span>
    {/each}
  </div>
{/if}

<style>
  .overview-zone-labels {
    position: absolute;
    inset: 0;
    z-index: 25;
    overflow: hidden;
    pointer-events: none;
  }

  .overview-zone-label {
    position: absolute;
    transform: translate(-50%, -50%);
    font-weight: 700;
    line-height: 1;
    white-space: nowrap;
    opacity: 0.6;
    user-select: none;
  }
</style>
