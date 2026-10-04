<script lang="ts">
  import type { Snippet } from "svelte";
  import { formatKey } from "../commands/keys";
  import { getCommand, runCommand } from "../commands/registry.svelte";
  import Tooltip from "./Tooltip.svelte";

  let {
    commandId,
    showLabel = false,
    labelOverride,
    className = "",
    secondaryHint,
    tooltipLabel,
    tooltipBindings,
    icon,
  } = $props<{
    commandId: string;
    showLabel?: boolean;
    labelOverride?: string;
    className?: string;
    secondaryHint?: string;
    tooltipLabel?: string;
    tooltipBindings?: string[];
    /** Replaces the built-in icon (drawn in the same 20×20 viewBox). */
    icon?: Snippet;
  }>();

  let command = $derived(getCommand(commandId));
  let iconName = $derived(iconForCommand(commandId));

  function preventMouseFocus(event: MouseEvent): void {
    if (event.button !== 0) return;
    event.preventDefault();
    if (commandId === "ui.commandSearch") return;
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
  }

  function iconForCommand(id: string): string {
    if (id === "view.home") return "home";
    if (id === "view.zoomIn") return "zoom-in";
    if (id === "view.zoomOut") return "zoom-out";
    if (id === "view.zoomReset") return "zoom-reset";
    if (id === "ui.toggleRightPanel") return "panel";
    if (id === "ui.settings") return "settings";
    if (id === "search.open") return "search";
    if (id === "grid.toggleShow") return "grid";
    if (id === "grid.toggleSnap") return "snap";
    if (id === "grid.stepUp") return "step-up";
    if (id === "grid.stepDown") return "step-down";
    if (id === "select.move") return "move";
    if (id === "tool.select") return "pointer";
    if (id === "tool.zone") return "zone";
    if (id === "tool.draw") return "draw";
    return "command";
  }
</script>

{#if command}
  <Tooltip label={tooltipLabel ?? command.label} bindings={tooltipBindings ?? command.keys} secondaryHint={secondaryHint}>
    <button
      type="button"
      class="command-button {className}"
      class:with-label={showLabel}
      class:active={command.isActive?.() ?? false}
      aria-label={`${command.label}${command.keys.length ? `; ${command.keys.map(formatKey).join(", ")}` : ""}`}
      aria-pressed={command.isActive ? command.isActive() : undefined}
      onmousedown={preventMouseFocus}
      onclick={() => runCommand(commandId)}
    >
      <svg viewBox="0 0 20 20" aria-hidden="true" focusable="false">
        {#if icon}
          {@render icon()}
        {:else if iconName === "home"}
          <path d="m2.8 9 7.2-6 7.2 6v7.4a.8.8 0 0 1-.8.8h-4.2v-5H7.8v5H3.6a.8.8 0 0 1-.8-.8z" />
        {:else if iconName === "zoom-in"}
          <circle cx="8.5" cy="8.5" r="5.3" />
          <path d="m12.4 12.4 4.4 4.4M8.5 5.8v5.4M5.8 8.5h5.4" />
        {:else if iconName === "zoom-out"}
          <circle cx="8.5" cy="8.5" r="5.3" />
          <path d="m12.4 12.4 4.4 4.4M5.8 8.5h5.4" />
        {:else if iconName === "zoom-reset"}
          <path d="M16.2 8.2A6.4 6.4 0 1 0 16 12M16.2 4.5v4h-4" />
          <circle cx="10" cy="10" r="1.5" />
        {:else if iconName === "panel"}
          <rect x="2.5" y="3" width="15" height="14" rx="1" />
          <path d="M11.5 3v14M14.5 7h1M14.5 10h1" />
        {:else if iconName === "settings"}
          <path d="M10 3.1 11.2 2l1.6.6.4 1.6 1.4.8 1.6-.4 1.1 1.3-.8 1.5.3 1.6 1.3 1v1.8l-1.5.8-.5 1.6.7 1.4-1.2 1.3-1.6-.5-1.4.8-.4 1.6-1.7.5-1-1.3-1.6-.2-1.4.8-1.4-1-.1-1.7-1.2-1-.1-1.7 1.3-1 .3-1.6-.9-1.4.9-1.5 1.7.1 1.2-1.1.1-1.7 1.6-.6z" transform="translate(0 -1) scale(1 .95)" />
          <circle cx="10" cy="10" r="2.4" />
        {:else if iconName === "search"}
          <circle cx="8.5" cy="8.5" r="5.2" />
          <path d="m12.4 12.4 4.3 4.3" />
        {:else if iconName === "grid"}
          <rect x="2.8" y="2.8" width="6.1" height="6.1" />
          <rect x="11.1" y="2.8" width="6.1" height="6.1" />
          <rect x="2.8" y="11.1" width="6.1" height="6.1" />
          <rect x="11.1" y="11.1" width="6.1" height="6.1" />
        {:else if iconName === "snap"}
          <path d="M5 3v7a5 5 0 0 0 10 0V3M3.5 3h3M13.5 3h3M10 15v2M7.5 17h5" />
        {:else if iconName === "step-up"}
          <path d="m4.5 12 5.5-5 5.5 5M10 7v9" />
        {:else if iconName === "step-down"}
          <path d="m4.5 8 5.5 5 5.5-5M10 4v9" />
        {:else if iconName === "move"}
          <path d="M10 3v14M3 10h14M7.5 5.5 10 3l2.5 2.5M7.5 14.5 10 17l2.5-2.5M5.5 7.5 3 10l2.5 2.5M14.5 7.5 17 10l-2.5 2.5" />
        {:else if iconName === "pointer"}
          <path d="M5 2.8v12.6l3.4-3.2 2.3 5.1 2.2-1-2.3-5h4.6z" />
        {:else if iconName === "zone"}
          <path d="M3.5 6.5 7 3.2l6.8 1.3 3 4.6-1.6 6.3-6.4 1.5-4.8-3.4z" stroke-dasharray="2.2 1.6" />
        {:else if iconName === "draw"}
          <path d="m12.8 3.6 3.6 3.6-8.6 8.6-4.4.8.8-4.4z" />
          <path d="m11.2 5.2 3.6 3.6" />
        {:else}
          <circle cx="10" cy="10" r="6.5" />
          <path d="M10 6.5v7M6.5 10h7" />
        {/if}
      </svg>
      {#if showLabel}<span>{labelOverride ?? command.label}</span>{/if}
    </button>
  </Tooltip>
{/if}

<style>
  .command-button {
    display: inline-flex;
    min-width: 28px;
    height: 28px;
    align-items: center;
    justify-content: center;
    gap: 7px;
    padding: 0 5px;
    color: var(--text);
    background: transparent;
    border: 1px solid transparent;
    border-radius: 3px;
    font: inherit;
    font-size: 11px;
    white-space: nowrap;
    cursor: pointer;
  }

  .command-button svg {
    width: 16px;
    height: 16px;
    flex: 0 0 auto;
    fill: none;
    stroke: currentColor;
    stroke-linecap: round;
    stroke-linejoin: round;
    stroke-width: 1.35;
  }

  .command-button:hover {
    background: var(--bg-hover);
  }

  .command-button:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: 1px;
  }

  .command-button.active,
  .command-button[aria-pressed="true"] {
    color: #fff0be;
    background: #413716;
    border-color: #806b2d;
  }

  .command-button.with-label {
    width: 100%;
    min-height: 32px;
    justify-content: flex-start;
    padding-inline: 8px;
    text-align: left;
  }

  .command-button.with-label span {
    overflow: hidden;
    text-overflow: ellipsis;
  }
</style>
