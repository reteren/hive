<script lang="ts">
  import type { ShownMessage } from "../time/types";
  import { IMPORTANCE_OPTIONS } from "../modules/moduleLogic";
  import { messageDueIso, messageDueLabel } from "./presentation";
  let { card, title, available, onClose, onGoTo }: {
    card: ShownMessage; title: string; available: boolean; onClose: () => void; onGoTo: () => void;
  } = $props();
  let fresh = $derived(Date.now() - card.shownAt < 1200);
  let color = $derived(IMPORTANCE_OPTIONS.find((option) => option.id === card.importance)?.color);
</script>

<article class="message-card" class:fresh class:rainbow={card.importance === "absolute"}
  data-shown-message={card.id} data-message-importance={card.importance ?? undefined}
  style:border-color={card.importance === "absolute" ? undefined : color}>
  {#if !card.headerHidden}<header data-message-card-header><span class="message-origin">{title}</span></header>{/if}
  <button type="button" class="message-close" data-message-close={card.id} aria-label="Close reminder"
    onpointerdown={(event) => event.preventDefault()} onclick={onClose}>×</button>
  <p class="message-preview">{card.text || "(Empty message)"}</p>
  <footer>
    <time datetime={messageDueIso(card.dueAt)}>{messageDueLabel(card.dueAt)}</time>
    {#if card.overlate}<span class="message-late" data-message-late>late</span>{/if}
    {#if available}<button type="button" class="message-go" data-message-go-to={card.id} onclick={onGoTo}>Go to</button>
    {:else}<span class="message-unavailable">Node unavailable</span>{/if}
  </footer>
</article>

<style>
  .message-card { position: relative; box-sizing: border-box; padding: 8px 9px; min-width: 0; border: 1px solid #4b4b4b; border-radius: 4px; color: var(--text, #ddd); background: #282828; font-size: 11px; transform-origin: center; }
  .fresh { animation: message-appear 800ms linear; }
  @keyframes message-appear { 0% { transform: scale(0); } 75% { transform: scale(1.3); } 100% { transform: scale(1); } }
  .rainbow { border-color: transparent; background: linear-gradient(#282828, #282828) padding-box, linear-gradient(110deg, #edc84d, #e05b5b, #a67be3, #78a9d4, #86b879, #edc84d) border-box; background-size: 100% 100%, 250% 100%; }
  header, footer { display: flex; align-items: center; gap: 6px; min-width: 0; }
  header { padding-right: 24px; min-height: 20px; }
  .message-origin { overflow: hidden; color: #bbb; font-size: 10px; text-overflow: ellipsis; white-space: nowrap; }
  .message-preview { display: -webkit-box; -webkit-box-orient: vertical; -webkit-line-clamp: 4; line-clamp: 4; overflow: hidden; margin: 6px 22px 8px 0; line-height: 1.4; white-space: pre-wrap; overflow-wrap: anywhere; }
  footer { color: #b0b0b0; font-size: 9px; flex-wrap: wrap; }
  .message-close { position: absolute; right: 5px; top: 5px; padding: 0; width: 22px; height: 22px; border: 0; color: #bbb; background: transparent; font: inherit; font-size: 17px; cursor: pointer; }
  .message-go { margin-left: auto; padding: 4px 7px; border: 1px solid #555; border-radius: 3px; color: #ddd; background: #333; font: inherit; font-size: 10px; cursor: pointer; }
  button:hover { color: #fff; border-color: var(--accent, #9e8642); }
  button:focus-visible { outline: 1px solid var(--accent, #9e8642); outline-offset: 1px; }
  .message-late { padding: 1px 4px; border-radius: 2px; color: #e6c87b; background: #554524; }
  .message-unavailable { margin-left: auto; }
  :global(html[data-reduce-motion="true"]) .fresh { animation: none; }
  @media (prefers-reduced-motion: reduce) { .fresh { animation: none; } }
</style>
