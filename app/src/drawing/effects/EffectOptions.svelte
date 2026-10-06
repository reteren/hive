<script lang="ts">
  import { imageErase } from "../../attachments/imageErase.svelte";
  import {
    drawingEffects,
    setEffectMode,
    setEffectStrength,
    setSwirlDirection,
  } from "./effectSettings.svelte";

  const effectModes = [
    { id: "blur", label: "Blur" },
    { id: "smudge", label: "Smudge" },
    { id: "swirl", label: "Swirl" },
  ] as const;
  let photoBlurActive = $derived(imageErase.mode === "blur");
  let activeMode = $derived(photoBlurActive ? "blur" : drawingEffects.mode);
  let activeStrength = $derived(activeMode === "blur" ? drawingEffects.blurStrength
    : activeMode === "smudge" ? drawingEffects.smudgeStrength : drawingEffects.swirlStrength);

  function updateStrength(event: Event): void {
    const value = Number((event.currentTarget as HTMLInputElement).value) / 100;
    setEffectStrength(activeMode, value);
  }
</script>

<section class="effect-options" data-effect-options aria-label="Effect options">
  <div class="field">
    <span>Effect</span>
    <div class="mode-options" role="group" aria-label="Drawing effect" data-effect-mode>
      {#each effectModes as option (option.id)}
        <button
          type="button"
          aria-pressed={activeMode === option.id}
          data-effect-choice={option.id}
          disabled={photoBlurActive}
          onclick={() => setEffectMode(option.id)}
        >{option.label}</button>
      {/each}
    </div>
  </div>

  <label class="field strength-field">
    <span><span>Strength</span><strong>{Math.round(activeStrength * 100)}%</strong></span>
    <input
      type="range"
      min="0"
      max="100"
      step="1"
      value={Math.round(activeStrength * 100)}
      aria-label={`${activeMode[0]!.toUpperCase()}${activeMode.slice(1)} strength`}
      data-effect-strength={activeMode}
      oninput={updateStrength}
    />
  </label>

  {#if activeMode === "swirl" && !photoBlurActive}
    <fieldset class="direction-field" data-swirl-direction>
      <legend>Direction</legend>
      <label>
        <input type="radio" name="swirl-direction" value="cw" checked={drawingEffects.swirlDirection === "cw"} onchange={() => setSwirlDirection("cw")} />
        Clockwise
      </label>
      <label>
        <input type="radio" name="swirl-direction" value="ccw" checked={drawingEffects.swirlDirection === "ccw"} onchange={() => setSwirlDirection("ccw")} />
        Counterclockwise
      </label>
    </fieldset>
  {/if}

  {#if activeMode === "swirl" && !photoBlurActive}
    <p class="hint">Press and hold at a point to twist the drawing.</p>
  {:else if activeMode === "blur"}
    <p class="hint">Drag over drawing or a photo to soften detail.</p>
  {:else}
    <p class="hint">Drag to pull nearby colour along the stroke.</p>
  {/if}
</section>

<style>
  .effect-options { display: grid; gap: 9px; }
  .field { display: grid; gap: 5px; }
  .field > span { display: flex; justify-content: space-between; color: var(--text-dim, #bcbcbc); }
  .field strong { color: var(--text, #ededed); font-variant-numeric: tabular-nums; }
  .mode-options { display: flex; gap: 4px; }
  .mode-options button {
    flex: 1;
    min-width: 0;
    padding: 5px 4px;
    border: 1px solid var(--border, #454545);
    border-radius: 3px;
    color: var(--text, #ededed);
    background: var(--bg-panel-raised);
    font: inherit;
    cursor: pointer;
  }
  .mode-options button[aria-pressed="true"] {
    border-color: var(--accent);
    color: var(--text, #ededed);
    background: var(--bg-hover);
  }
  .mode-options button:disabled { opacity: 0.65; cursor: default; }
  input[type="range"] { width: 100%; accent-color: var(--accent); }
  fieldset { min-width: 0; margin: 0; padding: 6px 7px; border: 1px solid var(--border, #454545); border-radius: 3px; }
  legend { padding: 0 4px; color: var(--text-dim, #bcbcbc); }
  .direction-field { display: flex; gap: 8px; flex-wrap: wrap; }
  .direction-field label { display: inline-flex; align-items: center; gap: 4px; }
  .direction-field input { accent-color: var(--accent); }
  .hint { margin: 0; color: var(--text-dim, #bcbcbc); line-height: 1.35; }
</style>
