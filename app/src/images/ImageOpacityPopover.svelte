<script lang="ts">
  import { camera, viewport } from "../board/camera.svelte";
  import { board } from "../model/board.svelte";
  import { boardPopupStyle, dismissBoardPopup } from "../ui/boardAnchor";
  import { MediaSlider } from "../media-ui";
  import {
    closeImageOpacityPopover,
    commitImageOpacity,
    imageOpacityPopover,
    previewImageOpacity,
  } from "./imageOpacity.svelte";
  import { imageOpacityFromSliderValue, imageOpacitySliderValue } from "./imageLogic";

  let active = $derived(imageOpacityPopover.current);
  let note = $derived(active ? board.notes[active.noteId] : undefined);

  function previewSliderValue(value: number): void {
    previewImageOpacity(imageOpacityFromSliderValue(value));
  }

  function commitSliderValue(value: number): void {
    commitImageOpacity(imageOpacityFromSliderValue(value));
  }
</script>

{#if active && note?.type === "image"}
  <div
    class="image-opacity-popover"
    data-image-opacity-popover
    data-note-id={active.noteId}
    role="dialog"
    aria-label="Image opacity"
    tabindex="-1"
    style={boardPopupStyle(camera, viewport, { x: active.x, y: active.y }, active.zoomAtOpen)}
    use:dismissBoardPopup={{ close: closeImageOpacityPopover }}
  >
    <div class="image-opacity-heading">
      <span>Opacity</span>
      <strong>{Math.round(active.value * 100)}%</strong>
    </div>
    <MediaSlider
      value={imageOpacitySliderValue(active.value)}
      max={90}
      step={5}
      label="Image opacity"
      oninput={previewSliderValue}
      onchange={commitSliderValue}
      tooltip={(value) => `${Math.round(value + 10)}%`}
    />
  </div>
{/if}

<style>
  .image-opacity-popover {
    position: absolute;
    z-index: 80;
    display: grid;
    width: 184px;
    gap: 8px;
    padding: 9px 10px;
    transform-origin: 0 0;
    border: 1px solid #5a5a5a;
    border-radius: 5px;
    color: var(--text, #eee);
    background: var(--bg-panel, #242424);
    box-shadow: 0 5px 16px rgb(0 0 0 / 42%);
    pointer-events: auto;
    user-select: none;
  }

  .image-opacity-heading {
    display: flex;
    align-items: center;
    justify-content: space-between;
    font-size: 11px;
  }

  .image-opacity-heading strong {
    color: #f4f4f4;
    font-variant-numeric: tabular-nums;
  }
</style>
