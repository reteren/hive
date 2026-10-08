<script lang="ts">
  import { drawingTools, setBrushSettings } from "../tools.svelte";
  import MediaSlider from "../../media-ui/MediaSlider.svelte";
  import { BRUSH_TIPS } from "./tips";

  let brush = $derived(drawingTools.brush);
  let angle = $derived(Math.round(brush.calligraphyAngle ?? 45));
  let density = $derived(brush.sprayDensity ?? 120);
  let densitySlider = $derived(density - 1);
  let dotSize = $derived(brush.sprayDotSize ?? 3);
  let dotSizeSlider = $derived(dotSize - 1);

  function updateAngle(value: number): void {
    setBrushSettings({ calligraphyAngle: value });
  }

  function updateDensity(value: number): void {
    setBrushSettings({ sprayDensity: value + 1 });
  }

  function updateDotSize(value: number): void {
    setBrushSettings({ sprayDotSize: value + 1 });
  }
</script>

<section class="brush-options" data-brush-tip-options>
  {#if drawingTools.active === "brush"}
    <div class="field" data-brush-tip>
      <span>Brush tip</span>
      <div class="tip-picker" role="group" aria-label="Brush tip">
        {#each BRUSH_TIPS as tip (tip.id)}
          <button
            type="button"
            title={tip.label}
            aria-label={tip.label}
            data-brush-tip-option={tip.id}
            aria-pressed={tip.id === (brush.tip ?? "round")}
            onclick={() => setBrushSettings({ tip: tip.id })}
          >
            <svg viewBox="0 0 20 20" aria-hidden="true" focusable="false">
              <!-- Each icon shows the mark the tip leaves. -->
              {#if tip.id === "round"}
                <circle class="solid" cx="10" cy="10" r="5" />
              {:else if tip.id === "calligraphy"}
                <path class="solid" d="M3.5 15.2c3.2-.6 5.6-3.4 7.4-6.6 1.2-2.1 2.6-3.7 5.6-4.1l-1.4 2.4c-2.1.5-3 1.9-4 3.8-1.6 3-4 5.3-7.6 5.9z" />
              {:else if tip.id === "charcoal"}
                <path d="M3.8 14.6c3-1.2 4.6-6.2 7.6-7.6 1.6-.7 3.2-.4 4.8-1.6" stroke-width="3.2" opacity="0.45" />
                <path d="M4.2 14.2c2.8-1.4 4.4-5.6 7.2-7 1.4-.6 2.8-.4 4.2-1.3" stroke-width="1.2" stroke-dasharray="1.4 1.1" />
              {:else}
                <circle class="solid" cx="10" cy="10" r="1.6" />
                <circle class="solid" cx="5.6" cy="8.2" r="1.1" />
                <circle class="solid" cx="14.2" cy="7.4" r="1.2" />
                <circle class="solid" cx="7.4" cy="13.8" r="1" />
                <circle class="solid" cx="13" cy="14.2" r="1.3" />
                <circle class="solid" cx="9.6" cy="4.8" r="0.9" />
                <circle class="solid" cx="15.6" cy="11.4" r="0.8" />
                <circle class="solid" cx="4.6" cy="12" r="0.7" />
              {/if}
            </svg>
          </button>
        {/each}
      </div>
    </div>
    {#if brush.tip === "calligraphy"}
      <label class="field" data-calligraphy-angle>
        <span>Nib angle <strong>{angle}°</strong></span>
        <MediaSlider
          value={angle}
          max={180}
          step={1}
          label="Calligraphy nib angle"
          oninput={updateAngle}
          onchange={updateAngle}
        />
      </label>
    {/if}
    {#if brush.tip === "spray"}
      <label class="field" data-spray-options data-spray-density>
        <span title="Dots per second at 24 px diameter; rate scales with brush area and pen pressure">Density <strong>{density} dots/s</strong></span>
        <MediaSlider
          value={densitySlider}
          max={199}
          step={1}
          label="Spray density"
          oninput={updateDensity}
          onchange={updateDensity}
        />
      </label>
      <label class="field" data-spray-dot-size>
        <span>Dot size <strong>{dotSize}px</strong></span>
        <MediaSlider
          value={dotSizeSlider}
          max={31}
          step={1}
          label="Spray dot size"
          oninput={updateDotSize}
          onchange={updateDotSize}
        />
      </label>
    {/if}
  {/if}
</section>

<style>
  .brush-options { display: grid; gap: 9px; }
  .field { display: grid; gap: 5px; color: var(--text, #eeeeee); font-size: 11px; }
  .field > span { display: flex; justify-content: space-between; align-items: baseline; color: var(--text-dim, #bcbcbc); }
  .field strong { color: var(--text, #ededed); font-variant-numeric: tabular-nums; }
  /* Small square accent buttons in one row (debug 32 #5); the active one is filled with the accent. */
  .tip-picker { display: flex; gap: 5px; }
  .tip-picker button {
    display: grid;
    width: 28px;
    height: 28px;
    flex: 0 0 auto;
    place-items: center;
    padding: 0;
    color: var(--accent);
    background: rgba(var(--accent-rgb), 0.1);
    border: 1px solid rgba(var(--accent-rgb), 0.32);
    border-radius: 4px;
    cursor: pointer;
    transition: background-color 120ms ease, border-color 120ms ease, color 120ms ease;
  }
  .tip-picker button:hover { background: rgba(var(--accent-rgb), 0.2); border-color: rgba(var(--accent-rgb), 0.55); }
  .tip-picker button[aria-pressed="true"] {
    color: var(--bg-panel, #1e1e1e);
    background: var(--accent);
    border-color: var(--accent);
  }
  .tip-picker button:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
  @media (prefers-reduced-motion: reduce) {
    .tip-picker button { transition: none; }
  }
  .tip-picker svg {
    width: 18px;
    height: 18px;
    fill: none;
    stroke: currentColor;
    stroke-width: 1.5;
    stroke-linecap: round;
    stroke-linejoin: round;
  }
  .tip-picker svg .solid { fill: currentColor; stroke: none; }
</style>
