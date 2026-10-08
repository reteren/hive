<script lang="ts">
  import { imageErase } from "../../attachments/imageErase.svelte";
  import MediaSlider from "../../media-ui/MediaSlider.svelte";
  import {
    drawingEffects,
    setEffectMode,
    setEffectStrength,
    setSwirlDirection,
    setSwirlSpeed,
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
  let swirlSpeedSlider = $derived(Math.round((drawingEffects.swirlSpeed - 0.1) * 10));

  function updateStrength(value: number): void {
    setEffectStrength(activeMode, value / 100);
  }

  function updateSwirlSpeed(value: number): void {
    setSwirlSpeed((value + 1) / 10);
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

  <label class="field strength-field" data-effect-strength={activeMode}>
    <span><span>Strength</span><strong>{Math.round(activeStrength * 100)}%</strong></span>
    <MediaSlider
      value={Math.round(activeStrength * 100)}
      max={100}
      step={1}
      label={`${activeMode[0]!.toUpperCase()}${activeMode.slice(1)} strength`}
      oninput={updateStrength}
      onchange={updateStrength}
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
    <label class="field" data-swirl-speed>
      <span>Speed <strong>{drawingEffects.swirlSpeed.toFixed(1)} rad/s</strong></span>
      <MediaSlider
        value={swirlSpeedSlider}
        max={79}
        step={1}
        label="Swirl speed in radians per second at full strength"
        oninput={updateSwirlSpeed}
        onchange={updateSwirlSpeed}
      />
    </label>
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
  fieldset { min-width: 0; margin: 0; padding: 6px 7px; border: 1px solid var(--border, #454545); border-radius: 3px; }
  legend { padding: 0 4px; color: var(--text-dim, #bcbcbc); }
  .direction-field { display: flex; gap: 8px; flex-wrap: wrap; }
  .direction-field label { display: inline-flex; align-items: center; gap: 4px; }
  .direction-field input { accent-color: var(--accent); }
</style>
