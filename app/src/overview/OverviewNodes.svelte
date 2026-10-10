<script lang="ts">
  import { camera, viewport } from "../board/camera.svelte";
  import { PX_PER_UNIT } from "../board/cameraMath";
  import { board } from "../model/board.svelte";
  import { BEACON_SIZE } from "../model/note";
  import { BEACON_PALETTE } from "../beacons/beaconPalette";
  import { noteBounds } from "../notes/layout.svelte";
  import { needsDarkText } from "../notes/noteColorLogic";
  import { overview } from "./overview.svelte";
  import { overviewFontSize, overviewLabelFor, overviewNameFor, overviewTextFits } from "./overviewLogic";

  // The whole Alt overview is ONE lightweight layer of plain boxes computed from the model. The real
  // notes/beacons layers are hidden with a single body attribute, so pressing Alt no longer makes
  // every node re-render and restyle its content (that was the lag on larger boards).
  const worldTransform = $derived(
    `translate(${viewport.width / 2}px, ${viewport.height / 2}px) ` +
      `scale(${camera.zoom}) ` +
      `translate(${-camera.x * PX_PER_UNIT}px, ${-camera.y * PX_PER_UNIT}px)`,
  );

  let items = $derived(overview.active
    ? board.order.flatMap((id) => {
      const note = board.notes[id];
      if (!note) return [];
      if (note.type === "beacon") {
        const size = BEACON_SIZE * PX_PER_UNIT;
        const scale = note.scale && note.scale !== 1 ? note.scale : 1;
        return [{
          id, beacon: true, x: note.x * PX_PER_UNIT, y: note.y * PX_PER_UNIT, w: size * scale, h: size * scale,
          kind: "Beacon", title: overviewLabelFor("beacon", note.name).title, color: note.color ?? BEACON_PALETTE[0],
          showText: overviewTextFits(size, size, camera.zoom, scale),
          font: overviewFontSize("Beacon", note.name, size, size) * scale,
        }];
      }
      const bounds = noteBounds(note);
      const w = bounds.width * PX_PER_UNIT;
      const h = bounds.height * PX_PER_UNIT;
      const label = overviewLabelFor(note.type, overviewNameFor(note), { gif: note.image?.mime === "image/gif" });
      return [{
        id, beacon: false, x: bounds.x * PX_PER_UNIT, y: bounds.y * PX_PER_UNIT, w, h,
        kind: label.kind, title: label.title, color: note.color ?? "",
        showText: overviewTextFits(w, h, camera.zoom),
        font: overviewFontSize(label.kind, label.title, w, h),
      }];
    })
    : []);
</script>

{#if overview.active}
  <div class="overview-layer" aria-hidden="true">
    <div class="overview-world" style:transform={worldTransform}>
      {#each items as item (item.id)}
        <div
          class="overview-box"
          class:beacon={item.beacon}
          data-overview-object={item.id}
          style:left={`${item.x}px`}
          style:top={`${item.y}px`}
          style:width={`${item.w}px`}
          style:height={`${item.h}px`}
          style:background={item.color || undefined}
          style:color={!item.beacon && needsDarkText(item.color) ? "#1f1f1f" : undefined}
        >
          {#if item.showText}
            <span class="overview-text" style:font-size={`${item.font}px`}>
              <span class="overview-kind" data-overview-node-label={item.beacon ? undefined : item.id} data-overview-beacon-label={item.beacon ? item.id : undefined}>{item.kind}</span>
              {#if item.title}<span class="overview-title">{item.title}</span>{/if}
            </span>
          {/if}
        </div>
      {/each}
    </div>
  </div>
{/if}

<style>
  .overview-layer {
    position: absolute;
    inset: 0;
    overflow: hidden;
    pointer-events: none;
  }

  .overview-world {
    position: absolute;
    inset: 0;
    transform-origin: 0 0;
  }

  .overview-box {
    position: absolute;
    box-sizing: border-box;
    display: flex;
    align-items: center;
    justify-content: center;
    border: 1px solid #4a4a4a;
    border-radius: 1px;
    background: #353535;
    color: #f1f1f1;
    overflow: hidden;
  }

  /* Beacons keep their own colour in the overview (user request), only the shape is simplified. */
  .overview-box.beacon {
    border: 0;
    border-radius: 50%;
    color: #fff;
    text-shadow: 0 1px 2px rgb(0 0 0 / 55%);
  }

  .overview-text {
    display: flex;
    max-width: 100%;
    flex-direction: column;
    align-items: center;
    padding: 2px;
    font-weight: 600;
    line-height: 1.1;
    text-align: center;
    user-select: none;
  }

  .overview-kind,
  .overview-title {
    max-width: 100%;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  :global(body[data-alt-overview="true"] .notes-world),
  :global(body[data-alt-overview="true"] .beacons-world) {
    visibility: hidden;
  }
</style>
