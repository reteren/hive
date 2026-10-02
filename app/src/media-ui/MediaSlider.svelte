<script lang="ts">
  import { clampSliderValue, sliderPercent, sliderRatioAtPoint, sliderValueAfterArrow, sliderValueAtPercent } from "./sliderLogic";

  interface Props {
    value: number;
    max: number;
    /** The position of the buffered end, in the same units as value. */
    buffered?: number;
    /** Quantization step passed to the native range input. */
    step?: number | "any";
    /** Accessible label for the slider. */
    label: string;
    orientation?: "horizontal" | "vertical";
    /** Called for pointer drags and keyboard changes. */
    oninput?: (value: number) => void;
    /** Called when the user commits a value. */
    onchange: (value: number) => void;
    /** Enables a hover / focus tooltip, typically formatted as media time. */
    tooltip?: (value: number) => string;
  }

  let {
    value,
    max,
    buffered = 0,
    step = "any",
    label,
    orientation = "horizontal",
    oninput,
    onchange,
    tooltip,
  }: Props = $props();
  let hoverRatio = $state<number | null>(null);
  let focused = $state(false);

  const safeMax = $derived(Number.isFinite(max) ? Math.max(0, max) : 0);
  const currentValue = $derived(clampSliderValue(value, safeMax));
  const filledPercent = $derived(sliderPercent(currentValue, safeMax));
  const bufferedPercent = $derived(Math.max(filledPercent, sliderPercent(buffered, safeMax)));
  const tooltipRatio = $derived(hoverRatio ?? filledPercent / 100);
  const tooltipValue = $derived(sliderValueAtPercent(tooltipRatio * 100, safeMax));

  function valueFromEvent(event: Event): number | null {
    if (!(event.currentTarget instanceof HTMLInputElement)) return null;
    return clampSliderValue(event.currentTarget.valueAsNumber, safeMax);
  }

  function updateValue(event: Event): void {
    const next = valueFromEvent(event);
    if (next === null) return;
    oninput?.(next);
    if (focused) hoverRatio = safeMax > 0 ? next / safeMax : 0;
  }

  function commitValue(event: Event): void {
    const next = valueFromEvent(event);
    if (next !== null) onchange(next);
  }

  function updateHover(event: PointerEvent): void {
    if (!(event.currentTarget instanceof HTMLElement)) return;
    const bounds = event.currentTarget.getBoundingClientRect();
    hoverRatio = sliderRatioAtPoint(bounds, event.clientX, event.clientY, orientation);
  }

  function handleKeydown(event: KeyboardEvent): void {
    const next = sliderValueAfterArrow(currentValue, safeMax, step, event.key, orientation);
    if (next === null) return;
    event.preventDefault();
    oninput?.(next);
    onchange(next);
    if (focused) hoverRatio = safeMax > 0 ? next / safeMax : 0;
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
  class:vertical={orientation === "vertical"}
  data-media-slider
  style={`--slider-fill: ${filledPercent}%; --slider-buffer: ${bufferedPercent}%; --tooltip-position: ${tooltipRatio * 100}%;`}
>
  <input
    type="range"
    min="0"
    max={safeMax}
    {step}
    value={currentValue}
    aria-label={label}
    aria-orientation={orientation}
    aria-valuetext={tooltip?.(currentValue)}
    oninput={updateValue}
    onchange={commitValue}
    onpointermove={updateHover}
    onpointerleave={clearHover}
    onkeydown={handleKeydown}
    onfocus={focusSlider}
    onblur={blurSlider}
  />
  {#if tooltip && (hoverRatio !== null || focused)}
    <span class="slider-tooltip" aria-hidden="true">{tooltip(tooltipValue)}</span>
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
    user-select: none;
    -webkit-user-select: none;
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
      #e8e8e8 0 var(--slider-fill),
      rgba(255, 255, 255, .5) var(--slider-fill) var(--slider-buffer),
      rgba(255, 255, 255, .25) var(--slider-buffer) 100%
    );
  }

  .media-slider input::-moz-range-track {
    height: 3px;
    border-radius: 999px;
    background: linear-gradient(
      to right,
      #e8e8e8 0 var(--slider-fill),
      rgba(255, 255, 255, .5) var(--slider-fill) var(--slider-buffer),
      rgba(255, 255, 255, .25) var(--slider-buffer) 100%
    );
  }

  .media-slider input::-webkit-slider-thumb {
    width: 8px;
    height: 8px;
    margin-top: -2.5px;
    appearance: none;
    border: 1px solid rgba(255, 255, 255, .85);
    border-radius: 50%;
    background: #fff;
    transition: transform 120ms ease;
  }

  .media-slider input::-moz-range-thumb {
    width: 7px;
    height: 7px;
    border: 1px solid rgba(255, 255, 255, .85);
    border-radius: 50%;
    background: #fff;
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
    left: var(--tooltip-position);
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

  .media-slider.vertical {
    width: 16px;
    min-width: 16px;
    height: 100%;
    min-height: 34px;
  }

  .media-slider.vertical input {
    width: 16px;
    height: 100%;
    writing-mode: vertical-lr;
    direction: rtl;
  }

  .media-slider.vertical input::-webkit-slider-runnable-track {
    width: 3px;
    height: auto;
    background: linear-gradient(
      to top,
      #e8e8e8 0 var(--slider-fill),
      rgba(255, 255, 255, .5) var(--slider-fill) var(--slider-buffer),
      rgba(255, 255, 255, .25) var(--slider-buffer) 100%
    );
  }

  .media-slider.vertical input::-moz-range-track {
    width: 3px;
    height: auto;
    background: linear-gradient(
      to top,
      #e8e8e8 0 var(--slider-fill),
      rgba(255, 255, 255, .5) var(--slider-fill) var(--slider-buffer),
      rgba(255, 255, 255, .25) var(--slider-buffer) 100%
    );
  }

  .media-slider.vertical input::-webkit-slider-thumb { margin-top: 0; margin-left: -2.5px; }
  .media-slider.vertical .slider-tooltip {
    top: calc(100% - var(--tooltip-position));
    bottom: auto;
    left: calc(100% + 5px);
    transform: translateY(-50%);
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
