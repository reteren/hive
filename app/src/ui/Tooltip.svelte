<script module lang="ts">
  let tooltipSequence = 0;
</script>

<script lang="ts">
  import { onDestroy, onMount, tick, type Snippet } from "svelte";
  import { formatKey } from "../commands/keys";

  let { label, bindings = [], secondaryHint, children } = $props<{
    label: string;
    bindings?: string[];
    secondaryHint?: string;
    children: Snippet;
  }>();

  const tooltipId = `command-tooltip-${++tooltipSequence}`;
  let trigger = $state<HTMLSpanElement>();
  let bubble = $state<HTMLDivElement>();
  let visible = $state(false);
  let position = $state({ left: 0, top: 0 });
  let timer: number | undefined;

  function hide(): void {
    if (timer !== undefined) {
      window.clearTimeout(timer);
      timer = undefined;
    }
    visible = false;
  }

  function positionBubble(): void {
    if (!trigger || !bubble) return;

    const triggerRect = trigger.getBoundingClientRect();
    const bubbleRect = bubble.getBoundingClientRect();
    const inset = 6;
    const maxLeft = Math.max(inset, window.innerWidth - bubbleRect.width - inset);
    const left = Math.min(maxLeft, Math.max(inset, triggerRect.left + (triggerRect.width - bubbleRect.width) / 2));
    const below = triggerRect.bottom + 7;
    const top = below + bubbleRect.height <= window.innerHeight - inset
      ? below
      : Math.max(inset, triggerRect.top - bubbleRect.height - 7);

    position = { left, top };
  }

  $effect(() => {
    label;
    bindings.join("|");
    secondaryHint;
    if (!visible) return;
    void tick().then(positionBubble);
  });

  async function showLater(): Promise<void> {
    hide();
    timer = window.setTimeout(async () => {
      visible = true;
      await tick();
      positionBubble();
    }, 420);
  }

  function handleFocusOut(event: FocusEvent): void {
    if (!(event.relatedTarget instanceof Node) || !trigger?.contains(event.relatedTarget)) hide();
  }

  onMount(() => {
    window.addEventListener("resize", positionBubble);
    window.addEventListener("scroll", positionBubble, true);
    return () => {
      window.removeEventListener("resize", positionBubble);
      window.removeEventListener("scroll", positionBubble, true);
    };
  });

  onDestroy(hide);
</script>

<span
  class="tooltip-trigger"
  bind:this={trigger}
  role="group"
  aria-label={`${label} command`}
  onmouseenter={showLater}
  onmouseleave={hide}
  onfocusin={showLater}
  onfocusout={handleFocusOut}
>
  {@render children()}
</span>

{#if visible}
  <div
    class="tooltip-bubble"
    id={tooltipId}
    role="tooltip"
    bind:this={bubble}
    style:left={`${position.left}px`}
    style:top={`${position.top}px`}
  >
    <span class="tooltip-copy">
      <span class="tooltip-label">{label}</span>
      {#if secondaryHint}<span class="tooltip-secondary">{secondaryHint}</span>{/if}
    </span>
    {#if bindings.length > 0}
      <span class="tooltip-bindings">
        {#each bindings as binding, index (binding)}
          {#if index > 0}<span class="binding-separator">/</span>{/if}
          <kbd>{formatKey(binding)}</kbd>
        {/each}
      </span>
    {/if}
  </div>
{/if}

<style>
  .tooltip-trigger {
    display: inline-flex;
    min-width: 0;
  }

  .tooltip-bubble {
    position: fixed;
    z-index: 1000;
    display: inline-flex;
    box-sizing: border-box;
    width: max-content;
    max-width: min(320px, calc(100vw - 12px));
    max-height: calc(100vh - 12px);
    align-items: flex-start;
    gap: 9px;
    flex-wrap: wrap;
    overflow: auto;
    padding: 5px 7px;
    color: var(--text);
    background: var(--bg-panel);
    border: 1px solid #555;
    border-radius: 3px;
    box-shadow: 0 3px 10px rgb(0 0 0 / 45%);
    pointer-events: none;
    font-size: 11px;
    line-height: 1.25;
    white-space: normal;
  }

  .tooltip-copy {
    display: inline-flex;
    min-width: 0;
    flex: 1 1 100px;
    flex-direction: column;
    gap: 2px;
  }

  .tooltip-label {
    overflow-wrap: anywhere;
  }

  .tooltip-secondary {
    color: var(--text-dim);
    font-size: 10px;
    overflow-wrap: anywhere;
    white-space: normal;
  }

  .tooltip-bindings {
    display: inline-flex;
    min-width: 0;
    flex: 0 1 auto;
    align-items: flex-start;
    gap: 4px;
    flex-wrap: wrap;
    color: var(--text-dim);
    white-space: normal;
  }

  kbd {
    padding: 1px 4px;
    color: var(--text);
    background: var(--bg-panel-raised);
    border: 1px solid var(--border);
    border-radius: 2px;
    font: inherit;
    white-space: nowrap;
  }

  .binding-separator {
    color: #777;
  }
</style>
