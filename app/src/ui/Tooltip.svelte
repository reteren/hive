<script module lang="ts">
  let tooltipSequence = 0;
</script>

<script lang="ts">
  import { onDestroy, onMount, tick, type Snippet } from "svelte";
  import { formatKey } from "../commands/keys";

  let { label, bindings = [], children } = $props<{
    label: string;
    bindings?: string[];
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
    <span class="tooltip-label">{label}</span>
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
    align-items: center;
    gap: 9px;
    max-width: calc(100vw - 12px);
    padding: 5px 7px;
    color: var(--text);
    background: #101010;
    border: 1px solid #555;
    border-radius: 3px;
    box-shadow: 0 3px 10px rgb(0 0 0 / 45%);
    pointer-events: none;
    font-size: 11px;
    line-height: 1.25;
    white-space: normal;
  }

  .tooltip-label {
    overflow-wrap: anywhere;
  }

  .tooltip-bindings {
    display: inline-flex;
    flex: 0 0 auto;
    align-items: center;
    gap: 4px;
    color: var(--text-dim);
    white-space: nowrap;
  }

  kbd {
    padding: 1px 4px;
    color: #eee;
    background: #292929;
    border: 1px solid #4a4a4a;
    border-radius: 2px;
    font: inherit;
    white-space: nowrap;
  }

  .binding-separator {
    color: #777;
  }
</style>
