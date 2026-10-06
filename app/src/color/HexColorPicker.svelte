<script lang="ts">
  import { untrack } from "svelte";
  import { hexToHsv, hsvToHex, normalizeHex, type Hsv } from "./hex";
  import { pushRecentColor, recentColors } from "./recentColors.svelte";
  import { pickScreenColor } from "./screenPicker.svelte";

  let { value, oninput, onchange, label = "Colour" } = $props<{
    /** Current colour as #rrggbb. */
    value: string;
    /** Every live change (dragging the square or the hue bar). */
    oninput?: (hex: string) => void;
    /** A finished pick: pointer released, HEX typed + Enter/blur, recent colour clicked. */
    onchange?: (hex: string) => void;
    label?: string;
  }>();

  // HSV is kept locally so the hue survives greys/black, where the hex alone loses it.
  let hsv = $state<Hsv>(hexToHsv("#000000"));
  let current = $state("#000000");
  let hexDraft = $state("000000");
  let hexFocused = $state(false);
  let lastPushAt = 0;
  let lastPushed: string | null = null;

  // Only `value` is tracked: a host that applies colours on commit must not snap a drag back.
  $effect(() => {
    const incoming = normalizeHex(value);
    untrack(() => {
      if (!incoming || incoming === current) return;
      current = incoming;
      const next = hexToHsv(incoming);
      hsv = next.s === 0 || next.v === 0 ? { ...next, h: hsv.h } : next;
      if (!hexFocused) hexDraft = incoming.slice(1);
    });
  });

  let hueColor = $derived(hsvToHex({ h: hsv.h, s: 1, v: 1 }));

  function emitInput(next: Hsv): void {
    hsv = next;
    current = hsvToHex(next);
    if (!hexFocused) hexDraft = current.slice(1);
    oninput?.(current);
  }

  async function pickFromScreen(): Promise<void> {
    const picked = await pickScreenColor();
    const hex = picked ? normalizeHex(picked) : null;
    if (!hex) return;
    const next = hexToHsv(hex);
    emitInput(next.s === 0 || next.v === 0 ? { ...next, h: hsv.h } : next);
    commit(current);
  }

  function commit(hex = current): void {
    // Several quick adjustments in a row count as one recent colour.
    const now = Date.now();
    if (lastPushed && now - lastPushAt < 1500) {
      recentColors.list = recentColors.list.filter((item) => item !== lastPushed);
    }
    pushRecentColor(hex);
    lastPushed = hex;
    lastPushAt = now;
    onchange?.(hex);
  }

  function dragOn(element: HTMLElement, event: PointerEvent, apply: (x: number, y: number) => void): void {
    if (event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    element.setPointerCapture(event.pointerId);
    const update = (pointer: PointerEvent) => {
      const rect = element.getBoundingClientRect();
      apply(
        Math.min(1, Math.max(0, (pointer.clientX - rect.left) / rect.width)),
        Math.min(1, Math.max(0, (pointer.clientY - rect.top) / rect.height)),
      );
    };
    const finish = () => {
      element.removeEventListener("pointermove", update);
      element.removeEventListener("pointerup", finish);
      element.removeEventListener("pointercancel", finish);
      commit();
    };
    update(event);
    element.addEventListener("pointermove", update);
    element.addEventListener("pointerup", finish);
    element.addEventListener("pointercancel", finish);
  }

  function areaKey(event: KeyboardEvent): void {
    const step = event.shiftKey ? 0.1 : 0.02;
    const delta = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, step], ArrowDown: [0, -step] }[event.key];
    if (!delta) return;
    event.preventDefault();
    emitInput({ h: hsv.h, s: Math.min(1, Math.max(0, hsv.s + delta[0])), v: Math.min(1, Math.max(0, hsv.v + delta[1])) });
    commit();
  }

  function hueKey(event: KeyboardEvent): void {
    const step = event.shiftKey ? 20 : 4;
    const delta = event.key === "ArrowLeft" || event.key === "ArrowDown" ? -step
      : event.key === "ArrowRight" || event.key === "ArrowUp" ? step : 0;
    if (!delta) return;
    event.preventDefault();
    emitInput({ ...hsv, h: Math.min(359.9, Math.max(0, hsv.h + delta)) });
    commit();
  }

  function commitHexDraft(): void {
    const hex = normalizeHex(hexDraft);
    if (!hex) {
      hexDraft = current.slice(1);
      return;
    }
    hexDraft = hex.slice(1);
    if (hex !== current) {
      const next = hexToHsv(hex);
      emitInput(next.s === 0 || next.v === 0 ? { ...next, h: hsv.h } : next);
    }
    commit(hex);
  }

  function pickRecent(hex: string): void {
    const next = hexToHsv(hex);
    emitInput(next.s === 0 || next.v === 0 ? { ...next, h: hsv.h } : next);
    lastPushed = null;
    commit(hex);
  }
</script>

<div class="hex-picker" data-hex-picker role="group" aria-label={label}>
  <div
    class="sv-area"
    role="slider"
    tabindex="0"
    aria-label={`${label}: saturation and brightness`}
    aria-valuetext={current}
    aria-valuenow={Math.round(hsv.s * 100)}
    style:--hue={hueColor}
    onpointerdown={(event) => dragOn(event.currentTarget, event, (x, y) => emitInput({ h: hsv.h, s: x, v: 1 - y }))}
    onkeydown={areaKey}
  >
    <span class="sv-thumb" style:left={`${hsv.s * 100}%`} style:top={`${(1 - hsv.v) * 100}%`} style:background={current}></span>
  </div>
  <div
    class="hue-bar"
    role="slider"
    tabindex="0"
    aria-label={`${label}: hue`}
    aria-valuemin={0}
    aria-valuemax={360}
    aria-valuenow={Math.round(hsv.h)}
    onpointerdown={(event) => dragOn(event.currentTarget, event, (x) => emitInput({ ...hsv, h: Math.min(359.9, x * 360) }))}
    onkeydown={hueKey}
  >
    <span class="hue-thumb" style:left={`${(hsv.h / 360) * 100}%`} style:background={hueColor}></span>
  </div>
  <div class="hex-row">
    <span class="current-swatch" style:background={current} aria-hidden="true"></span>
    <label class="hex-field">
      <span aria-hidden="true">#</span>
      <input
        type="text"
        maxlength="7"
        spellcheck="false"
        autocomplete="off"
        aria-label={`${label} HEX`}
        bind:value={hexDraft}
        onfocus={() => { hexFocused = true; }}
        onblur={() => { hexFocused = false; commitHexDraft(); }}
        oninput={() => {
          const hex = normalizeHex(hexDraft);
          if (hex && hexDraft.replace(/^#/, "").length === 6 && hex !== current) {
            const next = hexToHsv(hex);
            emitInput(next.s === 0 || next.v === 0 ? { ...next, h: hsv.h } : next);
          }
        }}
        onkeydown={(event) => {
          event.stopPropagation();
          if (event.key === "Enter") { event.preventDefault(); commitHexDraft(); }
        }}
      />
    </label>
    <button
      type="button"
      class="eyedropper-button"
      data-hex-eyedropper
      title="Pick a colour from the screen · Esc cancels"
      aria-label="Pick a colour from the screen"
      onclick={() => void pickFromScreen()}
    >
      <svg viewBox="0 0 16 16" aria-hidden="true" focusable="false">
        <path d="M10.6 2.4a1.9 1.9 0 0 1 2.7 2.7l-1.5 1.5.6.6-1 1-.6-.6-5 5H3.9v-1.9l5-5-.6-.6 1-1 .6.6z" />
      </svg>
    </button>
  </div>
  {#if recentColors.list.length > 0}
    <div class="recent" role="group" aria-label="Recent colours">
      {#each recentColors.list as color (color)}
        <button
          type="button"
          class="recent-swatch"
          class:selected={color === current}
          style:background={color}
          title={color}
          aria-label={`Recent colour ${color}`}
          aria-pressed={color === current}
          onpointerdown={(event) => event.preventDefault()}
          onclick={() => pickRecent(color)}
        ></button>
      {/each}
    </div>
  {/if}
</div>

<style>
  .hex-picker {
    display: grid;
    width: 100%;
    min-width: 160px;
    gap: 8px;
    font-size: 11px;
    user-select: none;
  }

  .sv-area {
    position: relative;
    height: 116px;
    border-radius: 3px;
    background:
      linear-gradient(to top, #000, transparent),
      linear-gradient(to right, #fff, var(--hue));
    cursor: crosshair;
    touch-action: none;
  }

  .hue-bar {
    position: relative;
    height: 10px;
    border-radius: 5px;
    background: linear-gradient(to right, #f00 0%, #ff0 16.67%, #0f0 33.33%, #0ff 50%, #00f 66.67%, #f0f 83.33%, #f00 100%);
    cursor: ew-resize;
    touch-action: none;
  }

  .sv-thumb, .hue-thumb {
    position: absolute;
    box-sizing: border-box;
    border: 2px solid #fff;
    border-radius: 50%;
    box-shadow: 0 0 0 1px rgb(0 0 0 / 55%), 0 1px 3px rgb(0 0 0 / 50%);
    pointer-events: none;
    transform: translate(-50%, -50%);
  }

  .sv-thumb { width: 12px; height: 12px; }
  .hue-thumb { top: 50%; width: 13px; height: 13px; }

  .sv-area:focus-visible, .hue-bar:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: 2px;
  }

  .hex-row {
    display: flex;
    align-items: center;
    gap: 7px;
  }

  .current-swatch {
    width: 22px;
    height: 22px;
    flex: 0 0 auto;
    border: 1px solid rgb(255 255 255 / 25%);
    border-radius: 3px;
  }

  .hex-field {
    display: flex;
    min-width: 0;
    flex: 1;
    align-items: center;
    gap: 2px;
    padding: 0 6px;
    border: 1px solid var(--border, #454545);
    border-radius: 3px;
    color: var(--text-dim, #bcbcbc);
    background: var(--bg-panel);
    font-family: var(--mono-font, monospace);
  }

  .hex-field:focus-within { border-color: var(--accent); }

  .hex-field input {
    width: 100%;
    min-width: 0;
    padding: 4px 0;
    border: 0;
    outline: none;
    color: var(--text, #ededed);
    background: transparent;
    font: inherit;
    text-transform: lowercase;
  }

  .recent {
    display: flex;
    flex-wrap: wrap;
    gap: 4px;
  }

  .recent-swatch {
    width: 16px;
    height: 16px;
    padding: 0;
    border: 1px solid rgb(255 255 255 / 22%);
    border-radius: 3px;
    cursor: pointer;
  }

  .recent-swatch:hover { border-color: rgb(255 255 255 / 60%); }
  .recent-swatch.selected { outline: 1px solid #fff; outline-offset: 1px; }

  .recent-swatch:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: 1px;
  }

  .eyedropper-button {
    display: grid;
    flex: 0 0 auto;
    width: 24px;
    height: 24px;
    padding: 0;
    place-items: center;
    border: 1px solid #484a50;
    border-radius: 3px;
    color: var(--icon);
    background: var(--bg-panel-raised);
    cursor: pointer;
  }

  .eyedropper-button:hover {
    border-color: #6a6d74;
    color: var(--icon);
  }

  .eyedropper-button svg {
    width: 14px;
    height: 14px;
    fill: none;
    stroke: currentColor;
    stroke-width: 1.3;
    stroke-linejoin: round;
  }
</style>
