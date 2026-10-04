<script lang="ts">
  import MediaSlider from "../media-ui/MediaSlider.svelte";
  import Tooltip from "../ui/Tooltip.svelte";
  import { tool } from "../tools/tool.svelte";
  import DrawCursor from "./DrawCursor.svelte";
  import { selectDrawingSubtool } from "./drawInput";
  import { drawingTools, setBrushSettings } from "./tools.svelte";
  import type { DrawTool } from "./types";

  const toolOptions: { id: DrawTool; label: string; key: string }[] = [
    { id: "brush", label: "Brush", key: "B" },
    { id: "eraser", label: "Eraser", key: "E" },
    { id: "fill", label: "Fill", key: "F" },
    { id: "select-rect", label: "Select rect", key: "M" },
    { id: "select-lasso", label: "Lasso", key: "L" },
    { id: "select-polygon", label: "Polygon", key: "P" },
  ];
  const palette = ["#e8e8e8", "#f2c14e", "#e4572e", "#52a675", "#4a90e2", "#b07ac5", "#252525"];

  let colorDraft = $state(drawingTools.brush.color);
  let isDrawing = $derived(tool.active === "draw");
  let opacitySlider = $derived(Math.round((drawingTools.brush.opacity - 0.05) / 0.95 * 100));
  let hardnessSlider = $derived(Math.round(drawingTools.brush.hardness * 100));

  $effect(() => {
    colorDraft = drawingTools.brush.color;
  });

  function updateSize(value: number): void {
    setBrushSettings({ size: value + 1 });
  }

  function updateOpacity(value: number): void {
    setBrushSettings({ opacity: 0.05 + Math.min(100, Math.max(0, value)) / 100 * 0.95 });
  }

  function updateHardness(value: number): void {
    setBrushSettings({ hardness: value / 100 });
  }

  function commitColor(): void {
    if (/^#[0-9a-f]{6}$/i.test(colorDraft)) setBrushSettings({ color: colorDraft });
    else colorDraft = drawingTools.brush.color;
  }
</script>

{#if isDrawing}
  <aside class="draw-toolbar" data-draw-toolbar data-draw-overlay-control aria-label="Drawing tools">
    <header>
      <strong>Drawing</strong>
      <button type="button" class="close-button" aria-label="Exit drawing mode" onclick={() => { tool.active = "select"; }}>×</button>
    </header>

    <div class="draw-tool-grid" role="group" aria-label="Drawing mode">
      {#each toolOptions as option (option.id)}
        <Tooltip
          label={option.label}
          bindings={[`Key${option.key}`]}
          secondaryHint={option.id === "eraser" ? "Eraser does not affect GIFs." : undefined}
        >
          <button
            type="button"
            class:active={drawingTools.active === option.id}
            aria-pressed={drawingTools.active === option.id}
            onclick={() => selectDrawingSubtool(option.id)}
          >
            <span>{option.label}</span><kbd>{option.key}</kbd>
          </button>
        </Tooltip>
      {/each}
    </div>

    <label class="field color-field">
      <span>Color</span>
      <input
        class="hex-input"
        type="text"
        maxlength="7"
        spellcheck="false"
        aria-label="Brush color hex"
        bind:value={colorDraft}
        onchange={commitColor}
      />
    </label>
    <div class="color-palette" role="group" aria-label="Color palette">
      {#each palette as color (color)}
        <button
          type="button"
          class:selected={drawingTools.brush.color === color}
          style={`--swatch:${color}`}
          aria-label={`Set brush color ${color}`}
          aria-pressed={drawingTools.brush.color === color}
          onclick={() => setBrushSettings({ color })}
        ></button>
      {/each}
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
  </aside>
  <DrawCursor />
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
    background: var(--bg-panel, #222);
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
    background: #2b2b2b;
    cursor: pointer;
  }

  button:hover, button.active, button[aria-pressed="true"] {
    border-color: #a7a7a7;
    background: #3b3b3b;
  }

  button:focus-visible, input:focus-visible {
    outline: 2px solid var(--accent, #c8a94e);
    outline-offset: 1px;
  }

  .close-button { width: 22px; height: 22px; font-size: 16px; line-height: 1; }

  .draw-tool-grid {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: 4px;
  }

  .draw-tool-grid button {
    display: flex;
    min-width: 0;
    min-height: 29px;
    align-items: center;
    justify-content: space-between;
    gap: 3px;
    padding: 4px 5px;
    text-align: left;
  }

  .draw-tool-grid :global(.tooltip-trigger) { width: 100%; }
  .draw-tool-grid :global(.tooltip-trigger button) { width: 100%; }

  kbd { color: #bdbdbd; font-size: 9px; }
  .field { display: grid; gap: 5px; }
  .field > span { color: var(--text-dim, #bcbcbc); }
  .field strong { color: var(--text, #ededed); font-variant-numeric: tabular-nums; }

  .hex-input, .number-input {
    min-width: 0;
    border: 1px solid var(--border, #454545);
    border-radius: 3px;
    padding: 4px 6px;
    color: var(--text, #ededed);
    background: #1b1b1b;
  }

  .hex-input { width: 82px; font-family: var(--mono-font, monospace); }
  .color-palette { display: flex; gap: 5px; }
  .color-palette button { width: 19px; height: 19px; padding: 2px; }
  .color-palette button::before {
    display: block;
    width: 100%;
    height: 100%;
    border-radius: 2px;
    background: var(--swatch);
    content: "";
  }
  .color-palette button.selected { outline: 1px solid #fff; outline-offset: 1px; }
  .size-control { gap: 9px; }
  .size-control :global(.media-slider) { flex: 1; }
  .number-input { width: 52px; padding: 3px 4px; }
  button:disabled { opacity: 0.5; cursor: default; }

  @media (max-width: 320px) {
    .draw-toolbar { left: 34px; width: calc(100vw - 46px); }
  }
</style>
