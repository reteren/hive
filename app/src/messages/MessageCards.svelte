<script lang="ts">
  import { onMount } from "svelte";
  import { board } from "../model/board.svelte";
  import { links } from "../model/links.svelte";
  import { dismissMessage, messageQueue } from "./messageQueue.svelte";
  import { goToMessage } from "./navigation";
  import { messageCardPresentation, visibleMessages, VISIBLE_MESSAGE_LIMIT } from "./presentation";
  import { installMessageSoundUnlock } from "./sound";
  import { initializeOverhiveBridge } from "./overhiveBridge.svelte";
  import ReminderCard from "./ReminderCard.svelte";
  let expanded = $state(false);
  let cards = $derived(visibleMessages(messageQueue.items, expanded)
    .map((card) => messageCardPresentation(card, board.notes, Object.values(links.byId))));
  let hidden = $derived(Math.max(0, messageQueue.items.length - VISIBLE_MESSAGE_LIMIT));
  onMount(() => {
    const disposeSound = installMessageSoundUnlock(document);
    const disposeOverhive = initializeOverhiveBridge();
    return () => { disposeSound(); disposeOverhive(); };
  });
  $effect(() => { if (!messageQueue.items.length) expanded = false; });
</script>

{#if messageQueue.items.length}
  <section class="message-cards" data-message-cards data-selection-ignore aria-label="Reminders">
    <div class="message-announcement" role="status" aria-live="polite" aria-atomic="true">{messageQueue.items.length} reminder{messageQueue.items.length === 1 ? "" : "s"}: {messageQueue.items[0]?.text}</div>
    <div class="message-list">
      {#each cards as card (card.id)}
        <ReminderCard {card} title={card.title} available={card.available}
          linkedNotes={card.linkedNotes} frameColors={card.customMarkFrameColors}
          onClose={() => dismissMessage(card.id)} onGoTo={() => goToMessage(card.id)} />
      {/each}
    </div>
    {#if hidden > 0}
      <button type="button" class="message-more" data-message-more aria-expanded={expanded} onclick={() => { expanded = !expanded; }}>
        {expanded ? "Show fewer" : `+${hidden} more`}
      </button>
    {/if}
  </section>
{/if}

<style>
  .message-cards { display: grid; gap: 5px; flex: 0 0 auto; width: 100%; min-width: 0; pointer-events: auto; }
  .message-list { display: grid; gap: 6px; max-height: min(540px, 65vh); overflow: auto; padding: 22px 35px; scrollbar-width: thin; }
  .message-more { padding: 4px 7px; border: 1px solid #4b4b4b; border-radius: 3px; color: var(--text); background: #282828; font: inherit; font-size: 10px; cursor: pointer; }
  .message-more:hover { border-color: var(--accent); }
  .message-more:focus-visible { outline: 1px solid var(--accent); outline-offset: 1px; }
  .message-announcement { position: absolute; width: 1px; height: 1px; padding: 0; overflow: hidden; clip-path: inset(50%); white-space: nowrap; }
</style>
