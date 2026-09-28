<script lang="ts">
  import { onMount } from "svelte";
  import { board } from "../model/board.svelte";
  import { dismissMessage, messageQueue } from "./messageQueue.svelte";
  import { goToMessage, messageTargetId } from "./navigation";
  import { messageDueIso, messageDueLabel, visibleMessages, VISIBLE_MESSAGE_LIMIT } from "./presentation";
  import { installMessageSoundUnlock } from "./sound";

  let expanded = $state(false);
  let cards = $derived(visibleMessages(messageQueue.items, expanded));
  let hidden = $derived(Math.max(0, messageQueue.items.length - VISIBLE_MESSAGE_LIMIT));
  onMount(() => installMessageSoundUnlock(document));
  $effect(() => { if (!messageQueue.items.length) expanded = false; });
</script>

{#if messageQueue.items.length}
  <section class="message-cards" data-message-cards data-selection-ignore aria-label="Reminders">
    <div class="message-announcement" role="status" aria-live="polite" aria-atomic="true">{messageQueue.items.length} reminder{messageQueue.items.length === 1 ? "" : "s"}: {messageQueue.items[0]?.text}</div>
    <div class="message-list">
      {#each cards as card (card.id)}
        <article class="message-card" data-shown-message={card.id}>
          <header>
            <span class="message-origin">{board.notes[messageTargetId(card)]?.name ?? "Reminder"}</span>
            <button type="button" class="message-close" data-message-close={card.id} aria-label="Close reminder"
              onpointerdown={(event) => event.preventDefault()} onclick={() => dismissMessage(card.id)}>×</button>
          </header>
          <p class="message-preview">{card.text || "(Empty message)"}</p>
          <footer>
            <time datetime={messageDueIso(card.dueAt)}>{messageDueLabel(card.dueAt)}</time>
            {#if card.overlate}<span class="message-late" data-message-late>late</span>{/if}
            {#if board.notes[messageTargetId(card)]}
              <button type="button" class="message-go" data-message-go-to={card.id} onclick={() => goToMessage(card.id)}>Go to</button>
            {:else}<span class="message-unavailable">Node unavailable</span>{/if}
          </footer>
        </article>
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
  .message-list { display: grid; gap: 6px; max-height: min(540px, 65vh); overflow: auto; scrollbar-width: thin; scrollbar-color: #505050 #1b1b1b; }
  .message-card { padding: 8px 9px; min-width: 0; border: 1px solid #5e542f; border-radius: 4px; color: var(--text); background: #28261f; box-shadow: 0 2px 8px rgb(0 0 0 / 20%); font-size: 11px; }
  header, footer { display: flex; align-items: center; gap: 6px; min-width: 0; }
  .message-origin { flex: 1; overflow: hidden; color: #d7ceb4; font-size: 10px; text-overflow: ellipsis; white-space: nowrap; }
  .message-preview { display: -webkit-box; -webkit-box-orient: vertical; -webkit-line-clamp: 4; line-clamp: 4; overflow: hidden; margin: 6px 0 8px; line-height: 1.4; white-space: pre-wrap; overflow-wrap: anywhere; }
  footer { color: var(--text-dim); font-size: 9px; flex-wrap: wrap; }
  .message-close { padding: 0; width: 22px; height: 22px; border: 0; color: var(--text-dim); background: transparent; font: inherit; font-size: 17px; cursor: pointer; }
  .message-go, .message-more { padding: 4px 7px; border: 1px solid #625a40; border-radius: 3px; color: #e9dfc1; background: #353127; font: inherit; cursor: pointer; }
  .message-go { margin-left: auto; font-size: 10px; }
  .message-more { font-size: 10px; }
  button:hover { color: var(--text); border-color: var(--accent); }
  button:focus-visible { outline: 1px solid var(--accent); outline-offset: 1px; }
  .message-late { padding: 1px 4px; border-radius: 2px; color: #e6c87b; background: #554524; }
  .message-unavailable { margin-left: auto; }
  .message-announcement { position: absolute; width: 1px; height: 1px; padding: 0; overflow: hidden; clip-path: inset(50%); white-space: nowrap; }
</style>
