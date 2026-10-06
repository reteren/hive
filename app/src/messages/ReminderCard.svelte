<script lang="ts">
  import { invoke } from "@tauri-apps/api/core";
  import { openUrl } from "@tauri-apps/plugin-opener";
  import { board } from "../model/board.svelte";
  import { createMarkdownFragment, linkedNoteIds } from "../editor/markdown";
  import { teleportToObject, teleportToPoint } from "../navigation/navigate";
  import { showLinkStatus } from "../links-in-text/contextMenu.svelte";
  import { customMarkGradientFor } from "../markas/markasLogic";
  import type { OverhiveNavigationTarget } from "./overhiveProtocol";
  import type { ShownMessage } from "../time/types";
  import { IMPORTANCE_OPTIONS } from "../modules/moduleLogic";
  import { messageDueIso, messageDueLabel } from "./presentation";

  let {
    card, title, available, onClose, onGoTo, linkedNotes = {}, frameColors = [], overhive = false, onNotice,
  }: {
    card: ShownMessage;
    title: string;
    available: boolean;
    onClose: () => void;
    onGoTo: () => void;
    linkedNotes?: Readonly<Record<string, string>>;
    frameColors?: readonly string[];
    overhive?: boolean;
    onNotice?: (message: string) => void;
  } = $props();

  let preview = $state<HTMLDivElement>();
  let renderedText: string | undefined;
  let renderedLinksKey = "";
  let fresh = $derived(Date.now() - card.shownAt < 1200);
  let importance = $derived(IMPORTANCE_OPTIONS.find((option) => option.id === card.importance));
  let frameGradient = $derived(customMarkGradientFor(frameColors));

  function resolveNote(noteId: string): { id: string; name: string } | undefined {
    if (overhive) {
      const name = linkedNotes[noteId];
      return name ? { id: noteId, name } : undefined;
    }
    const note = board.notes[noteId];
    return note ? { id: note.id, name: note.name } : undefined;
  }

  function showNotice(message: string): void {
    if (overhive) onNotice?.(message);
    else showLinkStatus(message);
  }

  function navigateFromOverhive(target: OverhiveNavigationTarget): void {
    void invoke("overhive_navigate", { target }).catch(() => showNotice("Could not open this link."));
  }

  $effect(() => {
    const source = card.text || "(Empty message)";
    const linksKey = JSON.stringify(linkedNoteIds(source).map((id) => [id, resolveNote(id)?.name ?? null]));
    if (!preview || (source === renderedText && linksKey === renderedLinksKey)) return;
    preview.replaceChildren(createMarkdownFragment(source, document, {
      resolveNote,
      openExternal: openUrl,
      teleportToPoint: (point) => {
        if (overhive) navigateFromOverhive({ kind: "point", ...point });
        else teleportToPoint(point, { label: "Text link" });
      },
      teleportToNote: (noteId) => {
        if (!resolveNote(noteId)) return false;
        if (overhive) navigateFromOverhive({ kind: "note", noteId });
        else return teleportToObject(noteId, { label: "Text link" });
        return true;
      },
      onNotice: showNotice,
    }));
    renderedText = source;
    renderedLinksKey = linksKey;
  });
</script>

<article class="message-card" class:fresh class:rainbow={card.importance === "absolute"}
  data-shown-message={card.id} data-message-importance={card.importance ?? undefined}
  data-message-mark-frame={frameColors.length > 0 ? "true" : undefined}
  data-message-mark-animated={frameColors.length > 1 ? "true" : undefined}
  style:--message-mark-gradient={frameGradient}
  style:border-color={frameColors.length > 0 || card.importance === "absolute" ? undefined : importance?.color}>
  {#if !card.headerHidden}<header data-message-card-header><span class="message-origin">{title}</span></header>{/if}
  <button type="button" class="message-close" data-message-close={card.id} aria-label="Close reminder"
    onpointerdown={(event) => event.preventDefault()} onclick={onClose}>×</button>
  <div bind:this={preview} class="message-preview" data-message-preview></div>
  <footer>
    {#if importance && frameColors.length > 0}
      <span class="importance-badge" data-message-importance-indicator title={`Importance: ${importance.label}`}>
        <i class:rainbow-dot={card.importance === "absolute"} class="importance-dot" style:background-color={importance.color}></i>
        {importance.label}
      </span>
    {/if}
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
  .message-card[data-message-mark-frame="true"] { border: 2px solid transparent; background: linear-gradient(#282828, #282828) padding-box, var(--message-mark-gradient) border-box; background-size: 100% 100%, 100% 100%; }
  .message-card[data-message-mark-animated="true"] { background-size: 100% 100%, 200% 100%; animation: message-mark-flow 8s linear infinite; }
  @keyframes message-mark-flow { from { background-position: 0 0, 0 0; } to { background-position: 0 0, -100% 0; } }
  header, footer { display: flex; align-items: center; gap: 6px; min-width: 0; }
  header { padding-right: 24px; min-height: 20px; }
  .message-origin { overflow: hidden; color: #bbb; font-size: 10px; text-overflow: ellipsis; white-space: nowrap; }
  .message-preview { display: -webkit-box; -webkit-box-orient: vertical; -webkit-line-clamp: 4; line-clamp: 4; overflow: hidden; margin: 6px 22px 8px 0; line-height: 1.4; overflow-wrap: anywhere; }
  .message-preview :global(p), .message-preview :global(ul), .message-preview :global(ol), .message-preview :global(blockquote) { margin: 0; }
  .message-preview :global(.md-link-text) { color: #83b8e8; text-decoration: underline; text-decoration-color: #557998; text-underline-offset: 2px; }
  .message-preview :global(.md-link-text.is-note-link) { text-decoration-color: #83b8e8; text-decoration-line: overline underline; }
  .message-preview :global(.md-link-text.is-point-link) { text-decoration-style: dotted; }
  .message-preview :global(.md-link-text.is-clickable) { cursor: pointer; }
  .message-preview :global(.md-link-text.is-clickable:focus-visible) { border-radius: 2px; outline: 1px solid var(--accent); outline-offset: 2px; }
  .message-preview :global(.md-link-text.is-missing) { color: #d88982; text-decoration-color: #8d5550; }
  footer { color: #b0b0b0; font-size: 9px; flex-wrap: wrap; }
  .importance-badge { display: inline-flex; align-items: center; gap: 4px; color: #ddd; white-space: nowrap; }
  .importance-dot { width: 6px; height: 6px; border-radius: 50%; background-color: currentColor; }
  .importance-dot.rainbow-dot { background: linear-gradient(135deg, #edc84d, #e05b5b, #a67be3, #78a9d4, #86b879); }
  .message-close { position: absolute; right: 5px; top: 5px; padding: 0; width: 22px; height: 22px; border: 0; color: #bbb; background: transparent; font: inherit; font-size: 17px; cursor: pointer; }
  .message-go { margin-left: auto; padding: 4px 7px; border: 1px solid #555; border-radius: 3px; color: #ddd; background: #333; font: inherit; font-size: 10px; cursor: pointer; }
  button:hover { color: var(--accent); border-color: var(--accent); }
  button:focus-visible { outline: 1px solid var(--accent); outline-offset: 1px; }
  .message-late { padding: 1px 4px; border-radius: 2px; color: #e6c87b; background: #554524; }
  .message-unavailable { margin-left: auto; }
  :global(html[data-reduce-motion="true"]) .fresh,
  :global(html[data-reduce-motion="true"]) .message-card[data-message-mark-animated="true"] { animation: none; }
  :global(html[data-reduce-motion="true"]) .message-card[data-message-mark-animated="true"] { background-position: 0 0, 0 0; }
  @media (prefers-reduced-motion: reduce) {
    .fresh, .message-card[data-message-mark-animated="true"] { animation: none; }
    .message-card[data-message-mark-animated="true"] { background-position: 0 0, 0 0; }
  }
</style>
