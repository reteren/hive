<script lang="ts">
  import "../board/gridCommands";
  import { grid, GRID_STEP_PRESETS, setGridStep } from "../board/grid.svelte";
  import { commands, runCommand } from "../commands/registry.svelte";

  const showCommand = commands.get("grid.toggleShow");
  const snapCommand = commands.get("grid.toggleSnap");
  let stepMenu: HTMLDetailsElement;
  let stepDraft = $state(String(grid.step));
  let stepError = $state("");
  let isGridShown = $derived(showCommand?.isActive?.() ?? false);
  let isSnapEnabled = $derived(snapCommand?.isActive?.() ?? false);

  function commandTitle(command: typeof showCommand): string {
    if (!command) return "";
    return `${command.label}${command.keys.length ? ` (${command.keys.join(", ")})` : ""}`;
  }

  function choosePreset(step: number): void {
    setGridStep(step);
    stepDraft = String(step);
    stepError = "";
    stepMenu.open = false;
  }

  function preventMouseFocus(event: MouseEvent): void {
    if (event.button !== 0) return;
    event.preventDefault();
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
  }

  function applyCustomStep(event: SubmitEvent): void {
    event.preventDefault();
    const step = Number(stepDraft);
    if (!Number.isFinite(step) || step <= 0) {
      stepError = "Enter a positive number.";
      return;
    }

    setGridStep(step);
    stepDraft = String(step);
    stepError = "";
    stepMenu.open = false;
  }
</script>

<div class="grid-controls" aria-label="Grid controls">
  {#if showCommand}
    <button
      type="button"
      class:active={isGridShown}
      aria-pressed={isGridShown}
      aria-label="Grid"
      title={commandTitle(showCommand)}
      onmousedown={preventMouseFocus}
      onclick={() => runCommand(showCommand.id)}
    >Grid</button>
  {/if}

  <details class="step-menu" bind:this={stepMenu}>
    <summary aria-label="Grid step">{grid.step} u</summary>
    <div class="step-popover">
      <form onsubmit={applyCustomStep}>
        <label for="custom-grid-step">Grid step</label>
        <div class="custom-step">
          <input
            id="custom-grid-step"
            type="number"
            min="0"
            step="any"
            bind:value={stepDraft}
            aria-invalid={stepError ? "true" : undefined}
            oninput={() => (stepError = "")}
          />
          <span>u</span>
          <button type="submit" onmousedown={preventMouseFocus}>Set</button>
        </div>
        {#if stepError}
          <span class="error" role="alert">{stepError}</span>
        {/if}
      </form>
      <div class="presets" aria-label="Grid step presets">
        {#each GRID_STEP_PRESETS as step (step)}
          <button
            type="button"
            class:active={grid.step === step}
            aria-pressed={grid.step === step}
            onmousedown={preventMouseFocus}
            onclick={() => choosePreset(step)}
          >{step}</button>
        {/each}
      </div>
    </div>
  </details>

  {#if snapCommand}
    <button
      type="button"
      class:active={isSnapEnabled}
      aria-pressed={isSnapEnabled}
      aria-label="Snapgrid"
      title={commandTitle(snapCommand)}
      onmousedown={preventMouseFocus}
      onclick={() => runCommand(snapCommand.id)}
    >Snap</button>
  {/if}
</div>

<style>
  .grid-controls {
    display: flex;
    height: 100%;
    align-items: center;
    gap: 4px;
    padding: 0 8px;
  }

  button,
  summary {
    height: 24px;
    padding: 0 8px;
    border: 1px solid var(--border);
    border-radius: 3px;
    background: var(--bg-panel-raised);
    color: var(--text);
    font: inherit;
    line-height: 22px;
    white-space: nowrap;
    cursor: pointer;
  }

  button:hover,
  summary:hover {
    background: var(--bg-hover);
  }

  button.active {
    border-color: var(--accent);
    background: var(--bg-active);
  }

  .step-menu {
    position: relative;
  }

  summary {
    display: block;
    list-style: none;
  }

  summary::-webkit-details-marker {
    display: none;
  }

  .step-popover {
    position: absolute;
    z-index: 20;
    top: calc(100% + 4px);
    left: 0;
    width: 184px;
    padding: 8px;
    border: 1px solid var(--border);
    border-radius: 4px;
    background: var(--bg-panel);
    box-shadow: 0 4px 12px rgb(0 0 0 / 35%);
  }

  form {
    display: grid;
    gap: 5px;
  }

  label {
    color: var(--text-dim);
  }

  .custom-step {
    display: flex;
    align-items: center;
    gap: 5px;
  }

  input {
    width: 100%;
    min-width: 0;
    height: 24px;
    padding: 0 5px;
    border: 1px solid var(--border);
    border-radius: 3px;
    background: var(--bg-board);
    color: var(--text);
    font: inherit;
  }

  .custom-step > span {
    color: var(--text-dim);
  }

  .presets {
    display: grid;
    grid-template-columns: repeat(4, 1fr);
    gap: 4px;
    margin-top: 8px;
  }

  .presets button {
    padding: 0;
  }

  .error {
    color: #f08080;
    font-size: 11px;
  }
</style>
