<script lang="ts">
  import { drawingTools, setBrushSettings } from "../tools.svelte";
  import { BRUSH_TIPS } from "./tips";

  let brush = $derived(drawingTools.brush);
  let angle = $derived(Math.round(brush.calligraphyAngle ?? 45));
  let density = $derived(brush.sprayDensity ?? 60);
  let dotSize = $derived(brush.sprayDotSize ?? 3);
</script>

<section class="brush-options" data-brush-tip-options>
  {#if drawingTools.active === "brush"}
    <div class="field" data-brush-tip>
      <span>Brush tip</span>
      <div class="tip-picker" role="group" aria-label="Brush tip">
        {#each BRUSH_TIPS as tip (tip.id)}
          <button
            type="button"
            data-brush-tip-option={tip.id}
            aria-pressed={tip.id === (brush.tip ?? "round")}
            onclick={() => setBrushSettings({ tip: tip.id })}
          >{tip.label}</button>
        {/each}
      </div>
    </div>
    {#if brush.tip === "calligraphy"}
      <label class="field" data-calligraphy-angle>
        <span>Nib angle <strong>{angle}°</strong></span>
        <input
          type="range"
          min="0"
          max="180"
          step="1"
          aria-label="Calligraphy nib angle"
          value={angle}
          oninput={(event) => setBrushSettings({ calligraphyAngle: event.currentTarget.valueAsNumber })}
        />
      </label>
    {/if}
  {/if}

  {#if drawingTools.active === "spray"}
    <label class="field" data-spray-options>
      <span title="Dots per second at 24 px diameter; rate scales with brush area and pen pressure">Density <strong>{density} dots/s</strong></span>
      <input
        type="range"
        min="1"
        max="200"
        step="1"
        aria-label="Spray density"
        data-spray-density
        value={density}
        oninput={(event) => setBrushSettings({ sprayDensity: event.currentTarget.valueAsNumber })}
      />
    </label>
    <label class="field">
      <span>Dot size <strong>{dotSize}px</strong></span>
      <input
        type="range"
        min="1"
        max="32"
        step="1"
        aria-label="Spray dot size"
        data-spray-dot-size
        value={dotSize}
        oninput={(event) => setBrushSettings({ sprayDotSize: event.currentTarget.valueAsNumber })}
      />
    </label>
  {/if}
</section>

<style>
  .brush-options { display: grid; gap: 9px; }
  .field { display: grid; gap: 5px; color: var(--text, #eeeeee); font-size: 12px; }
  .field span { display: flex; justify-content: space-between; align-items: baseline; }
  .field strong { font-variant-numeric: tabular-nums; }
  input[type="range"] { width: 100%; }
  .tip-picker { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 4px; }
  .tip-picker button {
    min-height: 27px;
    padding: 3px 6px;
    color: var(--text, #eeeeee);
    background: var(--surface, #292929);
    border: 1px solid var(--border, #454545);
    border-radius: 4px;
  }
  .tip-picker button[aria-pressed="true"] { border-color: var(--accent, #e8e8e8); font-weight: 700; }
  .tip-picker button:last-child { grid-column: 1 / -1; }
</style>
