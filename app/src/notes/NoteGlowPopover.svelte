<script lang="ts">
  import { camera, viewport } from "../board/camera.svelte";
  import { boardPopupStyle, dismissBoardPopup } from "../ui/boardAnchor";
  import HexColorPicker from "../color/HexColorPicker.svelte";
  import MediaSlider from "../media-ui/MediaSlider.svelte";
  import {
    closeNoteGlowPopover,
    noteGlowPopover,
    previewNoteGlowColor,
    previewNoteGlowOpacity,
    previewNoteGlowSize,
    setGlowColorAsMain,
  } from "./noteGlow.svelte";
  import { MAX_GLOW_SIZE, MIN_GLOW_SIZE } from "./noteGlowLogic";

  let active = $derived(noteGlowPopover.current);
  let opacitySlider = $derived(active ? Math.round((active.opacity - 0.05) / 0.95 * 100) : 0);
  let sizeSlider = $derived(active ? Math.round((active.size - MIN_GLOW_SIZE) * 10) : 0);

  function updateOpacity(value: number): void {
    previewNoteGlowOpacity(0.05 + Math.min(100, Math.max(0, value)) / 100 * 0.95);
  }

  function updateSize(value: number): void {
    previewNoteGlowSize(MIN_GLOW_SIZE + Math.min((MAX_GLOW_SIZE - MIN_GLOW_SIZE) * 10, Math.max(0, value)) / 10);
  }

  // Esc cancels wherever focus is (clicking a button or a slider moves focus around).
  $effect(() => {
    if (!active) return;
    const onWindowKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      closeNoteGlowPopover(false);
    };
    window.addEventListener("keydown", onWindowKey, true);
    return () => window.removeEventListener("keydown", onWindowKey, true);
  });

  function onKeyDown(event: KeyboardEvent): void {
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      closeNoteGlowPopover(false);
    } else if (event.key === "Enter" && !(event.target instanceof HTMLInputElement)) {
      event.preventDefault();
      closeNoteGlowPopover(true);
    }
  }
</script>

{#if active}
  <div
    class="note-glow-popover"
    data-glow-popover
    data-selection-ignore
    role="dialog"
    aria-label="Node glow"
    tabindex="-1"
    style={boardPopupStyle(camera, viewport, { x: active.x, y: active.y }, active.zoomAtOpen)}
    use:dismissBoardPopup={{ close: () => closeNoteGlowPopover(true), escape: false }}
    onkeydown={onKeyDown}
  >
    <span class="note-glow-title">{active.before[active.ids[0] ?? ""] ? "Edit glow" : "Add glow"}{active.ids.length > 1 ? ` · ${active.ids.length} nodes` : ""}</span>
    <HexColorPicker
      value={active.color}
      label="Glow color"
      oninput={previewNoteGlowColor}
      onchange={previewNoteGlowColor}
    />
    <button class="color-as-main" type="button" onclick={setGlowColorAsMain}>Color as main</button>
    <label class="field slider-field">
      <span>Opacity <strong>{Math.round(active.opacity * 100)}%</strong></span>
      <MediaSlider
        value={opacitySlider}
        max={100}
        step={1}
        label="Opacity"
        oninput={updateOpacity}
        onchange={updateOpacity}
        tooltip={(value) => `${Math.round((0.05 + value / 100 * 0.95) * 100)}%`}
      />
    </label>
    <label class="field slider-field">
      <span>Size <strong>{active.size.toFixed(1)} u</strong></span>
      <MediaSlider
        value={sizeSlider}
        max={(MAX_GLOW_SIZE - MIN_GLOW_SIZE) * 10}
        step={1}
        label="Size"
        oninput={updateSize}
        onchange={updateSize}
        tooltip={(value) => `${(MIN_GLOW_SIZE + value / 10).toFixed(1)} u`}
      />
    </label>
    <div class="note-glow-actions">
      <button type="button" onclick={() => closeNoteGlowPopover(false)}>Cancel</button>
      <button type="button" onclick={() => closeNoteGlowPopover(true)}>Done</button>
    </div>
  </div>
{/if}

<style>
  .note-glow-popover {
    position: absolute;
    z-index: 80;
    display: grid;
    width: 210px;
    gap: 8px;
    padding: 10px;
    border: 1px solid #555;
    border-radius: 5px;
    background: #292929;
    box-shadow: 0 5px 18px rgb(0 0 0 / 45%);
    color: #eee;
    font-size: 13px;
    pointer-events: auto;
    user-select: none;
  }

  .note-glow-popover:focus { outline: none; }
  .note-glow-title { display: block; color: #bdbdbd; font-size: 11px; }

  .field { display: grid; gap: 5px; }
  .field span { display: flex; justify-content: space-between; gap: 8px; color: #c8c8c8; }
  .field strong { color: #ededed; font-variant-numeric: tabular-nums; }

  .note-glow-popover button {
    min-height: 27px;
    padding: 4px 8px;
    border: 1px solid #555;
    border-radius: 3px;
    background: #383838;
    color: #eee;
    cursor: pointer;
  }

  .note-glow-popover button:hover { background: #484848; }
  .note-glow-actions { display: flex; justify-content: flex-end; gap: 6px; }
  .color-as-main { justify-self: start; }
</style>
