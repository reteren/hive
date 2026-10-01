<script lang="ts">
  import { clampSliderValue, sliderPercent, sliderValueAtPercent } from "./sliderLogic";

  interface Props {
    value: number;
    max: number;
    /** The position of the buffered end, in the same units as value. */
    buffered?: number;
    /** Accessible label for the native range control. */
    ariaLabel: string;
    /** Called for pointer drags and keyboard changes. */
    onChange: (value: number) => void;
    /** Enables the hover / focus tooltip, typically formatted as media time. */
    formatTooltip?: (value: number) => string;
  }

  let { value, max, buffered = 0, ariaLabel, onChange, formatTooltip }: Props = $props();
  let hoverRatio = $state<number | null>(null);
  let focused = $state(false);

  const safeMax = $derived(Number.isFinite(max) ? Math.max(0, max) : 0);
  const currentValue = $derived(clampSliderValue(value, safeMax));
  const filledPercent = $derived(sliderPercent(currentValue, safeMax));
  const bufferedPercent = $derived(Math.max(filledPercent, sliderPercent(buffered, safeMax)));
  const tooltipRatio = $derived(hoverRatio ?? filledPercent / 100);
  const tooltipValue = $derived(sliderValueAtPercent(tooltipRatio * 100, safeMax));

  function updateValue(event: Event): void {
    if (!(event.currentTarget instanceof HTMLInputElement)) return;
    const next = clampSliderValue(event.currentTarget.valueAsNumber, safeMax);
    onChange(next);
    if (focused) hoverRatio = safeMax > 0 ? next / safeMax : 0;
  }

  function updateHover(event: PointerEvent): void {
    if (!(event.currentTarget instanceof HTMLElement)) return;
    const bounds = event.currentTarget.getBoundingClientRect();
    if (bounds.width <= 0) return;
    const ratio = Math.min(1, Math.max(0, (event.clientX - bounds.left) / bounds.width));
    hoverRatio = ratio;
  }

  function clearHover(): void {
    if (!focused) hoverRatio = null;
  }

  function focusSlider(): void {
    focused = true;
    hoverRatio = safeMax > 0 ? currentValue / safeMax : 0;
  }

  function blurSlider(): void {
    focused = false;
    hoverRatio = null;
  }
</script>

<div
  class="media-slider"
  data-media-slider
  style={`--slider-fill: ${filledPercent}%; --slider-buffer: ${bufferedPercent}%;`}
>
  <input
    type="range"
    min="0"
    max={safeMax}
    step="any"
    value={currentValue}
    aria-label={ariaLabel}
    aria-valuetext={formatTooltip?.(currentValue)}
    oninput={updateValue}
    onpointermove={updateHover}
    onpointerleave={clearHover}
    onfocus={focusSlider}
    onblur={blurSlider}
  />
  {#if formatTooltip && (hoverRatio !== null || focused)}
    <span class="slider-tooltip" aria-hidden="true" style:left={`${tooltipRatio * 100}%`}>
      {formatTooltip(tooltipValue)}
    </span>
  {/if}
</div>

<style>
  .media-slider {
    position: relative;
    display: block;
    width: 100%;
    min-width: 34px;
    height: 16px;
    touch-action: none;
  }

  .media-slider input {
    position: absolute;
    inset: 0;
    box-sizing: border-box;
    width: 100%;
    height: 16px;
    margin: 0;
    padding: 0;
    appearance: none;
    border: 0;
    border-radius: 0;
    outline: none;
    background: transparent;
    cursor: pointer;
  }

  .media-slider input::-webkit-slider-runnable-track {
    height: 3px;
    border-radius: 999px;
    background: linear-gradient(
      to right,
      var(--accent) 0 var(--slider-fill),
      #626262 var(--slider-fill) var(--slider-buffer),
      #414141 var(--slider-buffer) 100%
    );
  }

  .media-slider input::-moz-range-track {
    height: 3px;
    border-radius: 999px;
    background: linear-gradient(
      to right,
      var(--accent) 0 var(--slider-fill),
      #626262 var(--slider-fill) var(--slider-buffer),
      #414141 var(--slider-buffer) 100%
    );
  }

  .media-slider input::-webkit-slider-thumb {
    width: 8px;
    height: 8px;
    margin-top: -2.5px;
    appearance: none;
    border: 1px solid #e7d19c;
    border-radius: 50%;
    background: var(--accent);
    transition: transform 120ms ease;
  }

  .media-slider input::-moz-range-thumb {
    width: 7px;
    height: 7px;
    border: 1px solid #e7d19c;
    border-radius: 50%;
    background: var(--accent);
    transition: transform 120ms ease;
  }

  .media-slider:hover input::-webkit-slider-thumb,
  .media-slider:focus-within input::-webkit-slider-thumb,
  .media-slider:hover input::-moz-range-thumb,
  .media-slider:focus-within input::-moz-range-thumb {
    transform: scale(1.35);
  }

  .media-slider:focus-within input {
    outline: 2px solid color-mix(in srgb, var(--accent) 35%, transparent);
    outline-offset: 3px;
  }

  .slider-tooltip {
    position: absolute;
    z-index: 3;
    bottom: calc(100% + 5px);
    padding: 3px 5px;
    transform: translateX(-50%);
    border: 1px solid #4a4a4a;
    border-radius: 3px;
    color: #d8d8d8;
    background: #222;
    font-size: 10px;
    font-variant-numeric: tabular-nums;
    line-height: 1.2;
    white-space: nowrap;
    pointer-events: none;
  }

  :global(html[data-reduce-motion="true"]) .media-slider input::-webkit-slider-thumb,
  :global(html[data-reduce-motion="true"]) .media-slider input::-moz-range-thumb {
    transition: none;
  }

  @media (prefers-reduced-motion: reduce) {
    .media-slider input::-webkit-slider-thumb,
    .media-slider input::-moz-range-thumb { transition: none; }
  }
</style>
