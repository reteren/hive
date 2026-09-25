<script lang="ts">
  import { tick } from "svelte";
  import { formatKey } from "../commands/keys";
  import { getCommand } from "../commands/registry.svelte";
  import { tool } from "../tools/tool.svelte";
  import { BRUSH_MAX, BRUSH_MIN } from "./brush";
  import { brushState, setBrushSize, stepBrushSize } from "./brushState.svelte";

  let editing = $state(false);
  let draftSize = $state<number | undefined>(undefined);
  let sizeInput = $state<HTMLInputElement>();

  const increaseTitle = $derived(commandTitle("zone.increaseBrushSize", "Increase brush size"));
  const decreaseTitle = $derived(commandTitle("zone.decreaseBrushSize", "Decrease brush size"));

  async function beginEditing(): Promise<void> {
    draftSize = brushState.size;
    editing = true;
    await tick();
    sizeInput?.focus();
    sizeInput?.select();
  }

  function commitEdit(): void {
    if (!editing) return;
    setBrushSize(draftSize ?? BRUSH_MIN);
    editing = false;
  }

  function cancelEdit(event: KeyboardEvent): void {
    event.preventDefault();
    event.stopPropagation();
    draftSize = undefined;
    editing = false;
  }

  function handleInputKeydown(event: KeyboardEvent): void {
    if (event.code === "Enter") {
      event.preventDefault();
      event.stopPropagation();
      commitEdit();
    } else if (event.code === "Escape") {
      cancelEdit(event);
    }
  }

  function adjustSize(direction: 1 | -1): void {
    stepBrushSize(direction);
    if (editing) draftSize = brushState.size;
  }

  function keepInputFocused(event: PointerEvent): void {
    if (editing) event.preventDefault();
  }

  function brushSizeWheel(node: HTMLElement): { destroy: () => void } {
    const onWheel = (event: WheelEvent): void => {
      if (event.ctrlKey || event.deltaY === 0) return;
      event.preventDefault();
      event.stopPropagation();
      adjustSize(event.deltaY < 0 ? 1 : -1);
    };
    node.addEventListener("wheel", onWheel, { passive: false });
    return { destroy: () => node.removeEventListener("wheel", onWheel) };
  }

  function commandTitle(id: string, label: string): string {
    const keys = getCommand(id)?.keys.map(formatKey).join(", ");
    return keys ? `${label} (${keys})` : `${label} (no key binding)`;
  }

</script>

{#if tool.active === "zone"}
  <div
    class="zone-brush-panel"
    data-selection-ignore
    role="group"
    aria-label="Zone brush size"
  >
    <span class="panel-label">Brush size</span>
    <div class="brush-controls">
      <div class="size-field" use:brushSizeWheel>
        {#if editing}
          <input
            bind:this={sizeInput}
            bind:value={draftSize}
            type="number"
            min={BRUSH_MIN}
            max={BRUSH_MAX}
            step="1"
            aria-label="Brush size"
            onkeydown={handleInputKeydown}
            onblur={commitEdit}
          />
        {:else}
          <button
            class="size-value"
            type="button"
            aria-label={`Brush size ${brushState.size}; click to enter a value or scroll to change`}
            title="Click to enter a size; scroll here to change it"
            onclick={() => void beginEditing()}
          >{brushState.size}</button>
        {/if}
      </div>
      <button
        class="step-button"
        type="button"
        aria-label="Decrease brush size"
        title={decreaseTitle}
        disabled={brushState.size <= BRUSH_MIN}
        onpointerdown={keepInputFocused}
        onclick={() => adjustSize(-1)}
      >−</button>
      <button
        class="step-button"
        type="button"
        aria-label="Increase brush size"
        title={increaseTitle}
        disabled={brushState.size >= BRUSH_MAX}
        onpointerdown={keepInputFocused}
        onclick={() => adjustSize(1)}
      >+</button>
    </div>
  </div>
{/if}

<style>
  .zone-brush-panel {
    position: absolute;
    z-index: 20;
    bottom: 10px;
    left: 10px;
    display: grid;
    min-width: 106px;
    gap: 4px;
    padding: 6px;
    border: 1px solid #414141;
    border-radius: 6px;
    background: rgb(28 28 28 / 94%);
    box-shadow: 0 3px 12px rgb(0 0 0 / 38%);
    color: var(--text);
    font: inherit;
    user-select: none;
    pointer-events: auto;
  }

  .panel-label {
    color: var(--text-dim);
    font-size: 9px;
    letter-spacing: 0.04em;
    line-height: 1;
    text-transform: uppercase;
  }

  .brush-controls {
    display: grid;
    grid-template-columns: minmax(42px, 1fr) 25px 25px;
    align-items: center;
    gap: 4px;
  }

  .size-field {
    min-width: 0;
  }

  .size-value,
  .size-field input,
  .step-button {
    box-sizing: border-box;
    height: 26px;
    border: 1px solid #484848;
    border-radius: 4px;
    background: #242424;
    color: var(--text);
    font: inherit;
  }

  .size-value,
  .size-field input {
    width: 100%;
    text-align: center;
    font-family: var(--mono-font);
    font-size: 11px;
  }

  .size-value {
    padding: 3px 5px;
    cursor: text;
  }

  .size-field input {
    padding: 3px 2px;
    border-color: var(--accent);
    user-select: text;
  }

  .step-button {
    padding: 0;
    color: #dedede;
    font-size: 15px;
    line-height: 1;
    cursor: pointer;
  }

  .size-value:hover,
  .step-button:not(:disabled):hover {
    border-color: #806b2d;
    background: #332d1c;
    color: #fff0be;
  }

  .size-value:focus-visible,
  .size-field input:focus-visible,
  .step-button:focus-visible {
    outline: 1px solid var(--accent);
    outline-offset: 1px;
  }

  .step-button:disabled {
    color: #626262;
    cursor: default;
  }
</style>
