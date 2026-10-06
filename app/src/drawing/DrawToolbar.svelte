<script lang="ts">
  import ShapeOptions from "./shapes/ShapeOptions.svelte";
  import BrushTipOptions from "./brushes/BrushTipOptions.svelte";
  import EffectOptions from "./effects/EffectOptions.svelte";
  import MediaSlider from "../media-ui/MediaSlider.svelte";
  import HexColorPicker from "../color/HexColorPicker.svelte";
  import { tool } from "../tools/tool.svelte";
  import DrawCursor from "./DrawCursor.svelte";
  import TextEditorOverlay from "./TextEditorOverlay.svelte";
  import { drawingTools, setBrushSettings } from "./tools.svelte";


  let isDrawing = $derived(tool.active === "draw");
  let opacitySlider = $derived(Math.round((drawingTools.brush.opacity - 0.05) / 0.95 * 100));
  let hardnessSlider = $derived(Math.round(drawingTools.brush.hardness * 100));

  function updateSize(value: number): void {
    setBrushSettings({ size: value + 1 });
  }

  function updateOpacity(value: number): void {
    setBrushSettings({ opacity: 0.05 + Math.min(100, Math.max(0, value)) / 100 * 0.95 });
  }

  function updateHardness(value: number): void {
    setBrushSettings({ hardness: value / 100 });
  }

</script>

{#if isDrawing}
  <aside class="draw-toolbar" data-draw-toolbar data-draw-overlay-control aria-label="Drawing tools">
    <header>
      <strong>Drawing</strong>
      <button type="button" class="close-button" aria-label="Exit drawing mode" onclick={() => { tool.active = "select"; }}>×</button>
    </header>


    <div class="field">
      <span>Color</span>
      <HexColorPicker
        value={drawingTools.brush.color}
        label="Brush colour"
        oninput={(color) => setBrushSettings({ color })}
      />
    </div>

    <label class="field slider-field">
      <span>Size <strong>{drawingTools.brush.size}px</strong></span>
      <div class="size-control">
        <MediaSlider
          value={drawingTools.brush.size - 1}
          max={399}
          step={1}
          label="Brush size"
          oninput={updateSize}
          onchange={updateSize}
          tooltip={(value) => `${Math.round(value + 1)} px`}
        />
        <input
          class="number-input"
          type="number"
          min="1"
          max="400"
          step="1"
          aria-label="Brush size in screen pixels"
          value={drawingTools.brush.size}
          oninput={(event) => setBrushSettings({ size: event.currentTarget.valueAsNumber })}
        />
      </div>
    </label>

    {#if drawingTools.active !== "eraser"}
      <label class="field slider-field">
        <span>Opacity <strong>{Math.round(drawingTools.brush.opacity * 100)}%</strong></span>
        <MediaSlider
          value={opacitySlider}
          max={100}
          step={1}
          label="Brush opacity"
          oninput={updateOpacity}
          onchange={updateOpacity}
          tooltip={(value) => `${Math.round((0.05 + value / 100 * 0.95) * 100)}%`}
        />
      </label>
    {/if}

    <!-- Text has no soft edge: hardness does not apply to it. -->
    {#if drawingTools.active !== "text"}
      <label class="field slider-field">
        <span>Hardness <strong>{Math.round(drawingTools.brush.hardness * 100)}%</strong></span>
        <MediaSlider
          value={hardnessSlider}
          max={100}
          step={1}
          label="Brush hardness"
          oninput={updateHardness}
          onchange={updateHardness}
          tooltip={(value) => `${Math.round(value)}%`}
        />
      </label>
    {/if}
    <!-- R10 delivery 2: each tool owns its options component (docs/handoff/d40_r10.md). -->
    {#if drawingTools.active === "shape"}<ShapeOptions />{/if}
    {#if drawingTools.active === "brush" || drawingTools.active === "spray"}<BrushTipOptions />{/if}
    {#if drawingTools.active === "effect"}<EffectOptions />{/if}
  </aside>
  <DrawCursor />
  <TextEditorOverlay />
{/if}

<style>
  .draw-toolbar {
    position: fixed;
    z-index: 24;
    top: 42px;
    left: 42px;
    display: grid;
    width: 246px;
    max-height: calc(100vh - 52px);
    gap: 10px;
    overflow: auto;
    padding: 11px;
    border: 1px solid var(--border, #454545);
    border-radius: 5px;
    color: var(--text, #ededed);
    background: var(--bg-panel);
    box-shadow: 0 6px 18px rgb(0 0 0 / 36%);
    font-size: 11px;
    scrollbar-width: thin;
  }

  header, .field > span, .size-control {
    display: flex;
    align-items: center;
  }

  header, .field > span { justify-content: space-between; }
  header { font-size: 12px; }

  button, input { font: inherit; }

  button {
    border: 1px solid var(--border, #454545);
    border-radius: 3px;
    color: var(--text, #ededed);
    background: var(--bg-panel-raised);
    cursor: pointer;
  }

  button:hover {
    border-color: #a7a7a7;
    background: var(--bg-hover);
  }

  button:focus-visible, input:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: 1px;
  }

  .close-button { width: 22px; height: 22px; font-size: 16px; line-height: 1; }


  .field { display: grid; gap: 5px; }
  .field > span { color: var(--text-dim, #bcbcbc); }
  .field strong { color: var(--text, #ededed); font-variant-numeric: tabular-nums; }

  .number-input {
    min-width: 0;
    border: 1px solid var(--border, #454545);
    border-radius: 3px;
    padding: 4px 6px;
    color: var(--text, #ededed);
    background: var(--bg-panel);
  }
  .size-control { gap: 9px; }
  .size-control :global(.media-slider) { flex: 1; }
  .number-input { width: 52px; padding: 3px 4px; }
  button:disabled { opacity: 0.5; cursor: default; }

  @media (max-width: 320px) {
    .draw-toolbar { left: 34px; width: calc(100vw - 46px); }
  }
</style>
