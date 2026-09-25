<script lang="ts">
  import { onMount } from "svelte";
  import "../board/gridCommands";
  import { decreaseGridStep, grid, increaseGridStep } from "../board/grid.svelte";
  import { formatKey } from "../commands/keys";
  import { getCommand, runCommand } from "../commands/registry.svelte";
  import magnetOffIcon from "./icons/magnet-off.svg";
  import magnetOnIcon from "./icons/magnet-on.svg";

  let controls: HTMLDivElement;
  let expandButton: HTMLButtonElement;
  let expanded = $state(false);
  let showCommand = $derived(getCommand("grid.toggleShow"));
  let snapCommand = $derived(getCommand("grid.toggleSnap"));
  let increaseCommand = $derived(getCommand("grid.stepUp"));
  let decreaseCommand = $derived(getCommand("grid.stepDown"));
  let isGridShown = $derived(showCommand?.isActive?.() ?? false);
  let isSnapEnabled = $derived(snapCommand?.isActive?.() ?? false);

  function commandTitle(command: typeof showCommand): string {
    if (!command) return "";
    const keys = command.keys.map(formatKey).join(", ");
    return keys ? `${command.label} · ${keys}` : command.label;
  }

  function stepTitle(): string {
    const increase = commandTitle(increaseCommand);
    const decrease = commandTitle(decreaseCommand);
    return `Grid step ${grid.step} u · Click: ${increase} · Right-click: ${decrease}`;
  }

  function onOutsidePointerDown(event: PointerEvent): void {
    if (!expanded || !(event.target instanceof Node) || controls.contains(event.target)) return;
    expanded = false;
  }

  function onWindowKeyDown(event: KeyboardEvent): void {
    if (!expanded || event.code !== "Escape" || event.defaultPrevented) return;
    event.preventDefault();
    event.stopPropagation();
    expanded = false;
    expandButton?.focus({ preventScroll: true });
  }

  function onStepPointerDown(event: PointerEvent): void {
    if (event.button !== 2) return;
    event.preventDefault();
    decreaseGridStep();
  }

  function preventStepContextMenu(event: MouseEvent): void {
    event.preventDefault();
  }

  onMount(() => {
    window.addEventListener("pointerdown", onOutsidePointerDown, true);
    window.addEventListener("keydown", onWindowKeyDown);
    return () => {
      window.removeEventListener("pointerdown", onOutsidePointerDown, true);
      window.removeEventListener("keydown", onWindowKeyDown);
    };
  });
</script>

<div class="grid-controls" bind:this={controls} data-selection-ignore aria-label="Grid controls">
  {#if snapCommand}
    <button
      class="grid-control-button magnet-button"
      class:enabled={isSnapEnabled}
      type="button"
      aria-label={commandTitle(snapCommand)}
      aria-pressed={isSnapEnabled}
      title={commandTitle(snapCommand)}
      onclick={() => runCommand(snapCommand.id)}
    >
      <img src={isSnapEnabled ? magnetOnIcon : magnetOffIcon} alt="" aria-hidden="true" />
    </button>
  {/if}

  <button
    class="grid-control-button expand-button"
    class:expanded
    type="button"
    bind:this={expandButton}
    aria-label="Grid settings"
    aria-expanded={expanded}
    aria-controls="grid-settings-popover"
    title="Grid settings"
    onclick={() => (expanded = !expanded)}
  >
    <svg class="expand-arrow" viewBox="0 0 20 20" aria-hidden="true" focusable="false">
      <path d="m4.5 7.5 5.5 5 5.5-5" />
    </svg>
  </button>

  {#if expanded}
    <section class="grid-settings-popover" id="grid-settings-popover" aria-label="Grid settings" data-selection-ignore>
      {#if showCommand}
        <button
          class="popover-row grid-toggle"
          type="button"
          aria-label={commandTitle(showCommand)}
          aria-pressed={isGridShown}
          title={commandTitle(showCommand)}
          onclick={() => runCommand(showCommand.id)}
        >
          <svg viewBox="0 0 18 18" aria-hidden="true" focusable="false">
            <path d="M2.5 2.5h5v5h-5zM10.5 2.5h5v5h-5zM2.5 10.5h5v5h-5zM10.5 10.5h5v5h-5z" />
          </svg>
          <span>Grid</span>
          <span class="toggle-state">{isGridShown ? "On" : "Off"}</span>
        </button>
      {/if}

      <div class="step-setting">
        <span class="step-label">Grid step</span>
        <button
          class="step-strip"
          type="button"
          aria-label={`${stepTitle()}. Activate to increase; right-click to decrease.`}
          title={stepTitle()}
          onpointerdown={onStepPointerDown}
          oncontextmenu={preventStepContextMenu}
          onclick={increaseGridStep}
        >
          <span class="step-value">{grid.step}</span>
          <span class="step-unit">u</span>
          <svg viewBox="0 0 18 18" aria-hidden="true" focusable="false">
            <path d="m5 7 4-4 4 4M5 11l4 4 4-4" />
          </svg>
        </button>
      </div>
      <p class="step-hint">Click to increase · Right-click to decrease</p>
    </section>
  {/if}
</div>

<style>
  .grid-controls {
    position: relative;
    display: inline-flex;
    align-items: center;
    gap: 4px;
  }

  .grid-control-button {
    display: inline-flex;
    width: 27px;
    height: 27px;
    align-items: center;
    justify-content: center;
    padding: 0;
    border: 1px solid #1a1a1a;
    border-radius: 5px;
    background: var(--bg-panel-raised);
    color: var(--text);
    cursor: pointer;
  }

  .grid-control-button:hover {
    background: var(--bg-hover);
  }

  .magnet-button.enabled,
  .expand-button.expanded {
    border-color: var(--accent);
    background: var(--accent);
    color: #24211b;
  }

  .magnet-button img {
    display: block;
    width: 16px;
    height: 16px;
  }

  .expand-arrow {
    width: 16px;
    height: 16px;
    fill: none;
    stroke: currentColor;
    stroke-width: 1.8;
    stroke-linecap: round;
    stroke-linejoin: round;
    transition: transform 140ms ease;
  }

  .expand-button.expanded .expand-arrow {
    transform: rotate(180deg);
  }

  .grid-settings-popover {
    position: absolute;
    z-index: 20;
    top: calc(100% + 5px);
    left: 50%;
    width: 188px;
    padding: 7px;
    transform: translateX(-50%);
    border: 1px solid var(--border);
    border-radius: 4px;
    background: var(--bg-panel);
    box-shadow: 0 4px 12px rgb(0 0 0 / 35%);
  }

  .popover-row {
    display: flex;
    width: 100%;
    min-height: 28px;
    align-items: center;
    gap: 7px;
    padding: 3px 5px;
    border: 1px solid transparent;
    border-radius: 3px;
    background: transparent;
    color: var(--text);
    font: inherit;
    text-align: left;
    cursor: pointer;
  }

  .popover-row:hover {
    background: var(--bg-hover);
  }

  .popover-row[aria-pressed="true"] {
    color: var(--accent);
  }

  .grid-toggle svg {
    width: 16px;
    height: 16px;
    fill: none;
    stroke: currentColor;
    stroke-width: 1.1;
  }

  .toggle-state {
    margin-left: auto;
    color: var(--text-dim);
    font-size: 10px;
  }

  .step-setting {
    display: grid;
    grid-template-columns: 1fr auto;
    align-items: center;
    gap: 8px;
    margin-top: 5px;
    padding-top: 7px;
    border-top: 1px solid #3b3b3b;
  }

  .step-label {
    color: var(--text-dim);
    font-size: 11px;
  }

  .step-strip {
    display: flex;
    min-width: 82px;
    height: 26px;
    align-items: center;
    justify-content: center;
    gap: 4px;
    padding: 0 5px;
    border: 1px solid var(--border);
    border-radius: 3px;
    background: var(--bg-panel-raised);
    color: var(--text);
    font: inherit;
    cursor: pointer;
  }

  .step-strip:hover {
    border-color: var(--accent);
  }

  .step-value {
    min-width: 20px;
    font-family: var(--mono-font);
    font-variant-numeric: tabular-nums;
    text-align: right;
  }

  .step-unit {
    color: var(--text-dim);
    font-size: 10px;
  }

  .step-strip svg {
    width: 14px;
    height: 14px;
    fill: none;
    stroke: var(--text-dim);
    stroke-width: 1.3;
    stroke-linecap: round;
    stroke-linejoin: round;
  }

  .step-hint {
    margin: 5px 0 0;
    color: var(--text-dim);
    font-size: 9px;
  }

  :global(html[data-reduce-motion="true"]) .expand-arrow {
    transition: none;
  }

  @media (prefers-reduced-motion: reduce) {
    .expand-arrow {
      transition: none;
    }
  }
</style>
