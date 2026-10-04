<script lang="ts">
  import type { Snippet } from "svelte";
  import { formatKey } from "../commands/keys";
  import Tooltip from "./Tooltip.svelte";

  let { label, bindings = [], secondaryHint, active = false, index = 0, onselect, children } = $props<{
    label: string;
    bindings?: string[];
    secondaryHint?: string;
    active?: boolean;
    /** Position in the group; staggers the appear animation. */
    index?: number;
    onselect: () => void;
    children: Snippet;
  }>();

  function preventMouseFocus(event: MouseEvent): void {
    if (event.button !== 0) return;
    event.preventDefault();
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
  }
</script>

<!-- A mode's sub-tool in the left hotbar (draw tools, line kinds). -->
<span class="subtool" style:--i={index}>
  <Tooltip {label} {bindings} {secondaryHint}>
    <button
      type="button"
      class="subtool-button"
      class:active
      aria-label={`${label}${bindings.length ? `; ${bindings.map(formatKey).join(", ")}` : ""}`}
      aria-pressed={active}
      onmousedown={preventMouseFocus}
      onclick={onselect}
    >
      <svg viewBox="0 0 20 20" aria-hidden="true" focusable="false">{@render children()}</svg>
    </button>
  </Tooltip>
</span>

<style>
  .subtool {
    display: inline-flex;
    animation: subtool-in 170ms cubic-bezier(0.2, 0.8, 0.3, 1) backwards;
    animation-delay: calc(var(--i) * 28ms);
  }

  @keyframes subtool-in {
    from {
      opacity: 0;
      transform: translateY(-6px) scale(0.85);
    }
  }

  .subtool-button {
    display: inline-flex;
    width: 28px;
    height: 26px;
    align-items: center;
    justify-content: center;
    padding: 0;
    color: var(--text-dim, #bcbcbc);
    background: transparent;
    border: 1px solid transparent;
    border-radius: 3px;
    cursor: pointer;
  }

  .subtool-button:hover {
    color: var(--text);
    background: var(--bg-hover);
  }

  .subtool-button:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: 1px;
  }

  .subtool-button.active {
    color: #fff0be;
    background: #413716;
    border-color: #806b2d;
  }

  svg {
    width: 16px;
    height: 16px;
    fill: none;
    stroke: currentColor;
    stroke-linecap: round;
    stroke-linejoin: round;
    stroke-width: 1.35;
  }

  :global(html[data-reduce-motion="true"]) .subtool {
    animation: none;
  }

  @media (prefers-reduced-motion: reduce) {
    .subtool {
      animation: none;
    }
  }
</style>
