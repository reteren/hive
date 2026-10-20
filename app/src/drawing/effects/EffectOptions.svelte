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
  import { t } from "../../i18n/i18n.svelte";

  const effectModes = [
    { id: "blur", get label() { return t("Blur"); } },
    { id: "smudge", get label() { return t("Smudge"); } },
    { id: "swirl", get label() { return t("Swirl"); } },
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

<section class="effect-options" data-effect-options aria-label={t("Effect options")}>
  <div class="field">
    <span>{t("Effect")}</span>
    <div class="mode-options" role="group" aria-label={t("Drawing effect")} data-effect-mode>
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
    <span><span>{t("Strength")}</span><strong>{Math.round(activeStrength * 100)}%</strong></span>
    <MediaSlider
      value={Math.round(activeStrength * 100)}
      max={100}
      step={1}
      label={activeMode === "blur" ? t("Blur strength") : activeMode === "smudge" ? t("Smudge strength") : t("Swirl strength")}
      oninput={updateStrength}
      onchange={updateStrength}
    />
  </label>

  {#if activeMode === "swirl" && !photoBlurActive}
    <fieldset class="direction-field" data-swirl-direction>
      <legend>{t("Direction")}</legend>
      <label>
        <input type="radio" name="swirl-direction" value="cw" checked={drawingEffects.swirlDirection === "cw"} onchange={() => setSwirlDirection("cw")} />
        {t("Clockwise")}
      </label>
      <label>
        <input type="radio" name="swirl-direction" value="ccw" checked={drawingEffects.swirlDirection === "ccw"} onchange={() => setSwirlDirection("ccw")} />
        {t("Counterclockwise")}
      </label>
    </fieldset>
  {/if}

  {#if activeMode === "swirl" && !photoBlurActive}
    <label class="field" data-swirl-speed>
      <span>{t("Speed")} <strong>{drawingEffects.swirlSpeed.toFixed(1)} rad/s</strong></span>
      <MediaSlider
        value={swirlSpeedSlider}
        max={79}
        step={1}
        label={t("Swirl speed in radians per second at full strength")}
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
