<script lang="ts">
  import { formatKey } from "../commands/keys";
  import { getCommand, runCommand } from "../commands/registry.svelte";
  import CommandButton from "./CommandButton.svelte";
  import Tooltip from "./Tooltip.svelte";
  import { isLineTool, tool } from "../tools/tool.svelte";

  let searchCommand = $derived(getCommand("search.open"));
  let shapeLabel = $derived(tool.lineShape[0].toUpperCase() + tool.lineShape.slice(1));
  let shapeBindings = $derived(searchCommand?.keys ?? []);
</script>

<!-- Left vertical panel of working tools (R0.4). -->
<nav class="left-toolbar" aria-label="Navigation tools">
  <CommandButton commandId="view.home" />
  <CommandButton commandId="notes.createMenu" />
  <CommandButton commandId="tool.select" />
  <CommandButton commandId="select.move" />
  <CommandButton commandId="tool.lineStrong" />
  <CommandButton commandId="tool.lineWeak" />
  {#if isLineTool()}
    <Tooltip label={`Line shape: ${shapeLabel}`} bindings={shapeBindings}>
      <button
        type="button"
        class="shape-button"
        aria-label={`Line shape: ${shapeLabel}${shapeBindings.length ? `; ${shapeBindings.map(formatKey).join(", ")}` : ""}`}
        onclick={() => runCommand("line.cycleShape")}
      >
        <svg viewBox="0 0 20 20" aria-hidden="true" focusable="false">
          {#if tool.lineShape === "straight"}
            <path d="M4 15 16 5" />
          {:else if tool.lineShape === "curved"}
            <path d="M4 15 C9 15 10 5 16 5" />
          {:else if tool.lineShape === "orthogonal"}
            <path d="M4 15 H10 V5 H16" />
          {:else if tool.lineShape === "wave"}
            <path d="M4 10 C6 4 8 4 10 10 C12 16 14 16 16 10" />
          {:else}
            <path d="M4 14 7 6 10 14 13 6 16 14" />
          {/if}
        </svg>
      </button>
    </Tooltip>
  {/if}
</nav>

<style>
  .left-toolbar {
    display: flex;
    width: 34px;
    height: 100%;
    flex-direction: column;
    align-items: center;
    gap: 3px;
    padding: 5px 3px;
    background: var(--bg-panel);
    border-right: 1px solid var(--border);
  }

  .shape-button {
    display: inline-flex;
    width: 28px;
    height: 28px;
    align-items: center;
    justify-content: center;
    padding: 4px;
    border: 1px solid transparent;
    border-radius: 3px;
    background: transparent;
    color: var(--text);
    cursor: pointer;
  }

  .shape-button:hover {
    background: var(--bg-hover);
  }

  .shape-button:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: 1px;
  }

  .shape-button svg {
    width: 18px;
    height: 18px;
    fill: none;
    stroke: currentColor;
    stroke-linecap: round;
    stroke-linejoin: round;
    stroke-width: 1.8;
  }

  @media (max-width: 520px) {
    .left-toolbar {
      width: 32px;
      padding-inline: 2px;
    }
  }
</style>
