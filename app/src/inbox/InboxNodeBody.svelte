<script lang="ts">
  import { board } from "../model/board.svelte";
  import { links } from "../model/links.svelte";
  import type { Note } from "../model/note";
  import { teleportToObject } from "../navigation/navigate";
  import { resolveInboxTwin } from "./inbox.svelte";

  let { note }: { note: Note } = $props();
  let entries = $derived.by(() => {
    const order = new Map(board.order.map((id, index) => [id, index]));
    const linked = Object.values(links.byId).flatMap((link) => {
      if (link.from !== note.id || link.kind !== "strong") return [];
      const target = board.notes[link.to];
      return target ? [{ note: target, order: order.get(target.id) ?? -1 }] : [];
    });
    linked.sort((first, second) => (second.note.createdAt ?? 0) - (first.note.createdAt ?? 0) || second.order - first.order);
    return { count: linked.length, latest: linked.slice(0, 3).map(({ note: target }) => target) };
  });

  function openEntry(target: Note): void {
    resolveInboxTwin(target.id);
    teleportToObject(target.id, { label: "Open Inbox entry" });
  }
</script>

<section class="inbox-body" data-inbox-node={note.id} aria-label={`Inbox ${note.name}`}>
  <header class="inbox-heading">
    <strong>Inbox</strong>
    <span data-inbox-entry-count>{entries.count} {entries.count === 1 ? "entry" : "entries"}</span>
  </header>
  {#if entries.latest.length > 0}
    <ul class="inbox-entry-list" data-inbox-entry-list>
      {#each entries.latest as entry (entry.id)}
        <li>
          <button type="button" data-inbox-entry={entry.id} data-selection-ignore title={entry.name} onclick={() => openEntry(entry)}>
            {entry.name}
          </button>
        </li>
      {/each}
    </ul>
  {:else}
    <p class="inbox-empty">New quick inputs will appear here.</p>
  {/if}
</section>

<style>
  .inbox-body { display: grid; min-width: 0; gap: 5px; font-size: 11px; }
  .inbox-heading { display: flex; align-items: baseline; justify-content: space-between; gap: 8px; }
  .inbox-heading strong { color: var(--accent); font-size: 12px; }
  .inbox-heading span,
  .inbox-empty { margin: 0; color: var(--text-dim); font-size: 10px; }
  .inbox-entry-list { display: grid; gap: 2px; margin: 0; padding: 0; list-style: none; }
  .inbox-entry-list button {
    width: 100%;
    overflow: hidden;
    padding: 3px 4px;
    border: 0;
    border-radius: 2px;
    color: var(--text);
    background: transparent;
    font: inherit;
    text-align: left;
    text-overflow: ellipsis;
    white-space: nowrap;
    cursor: pointer;
  }
  .inbox-entry-list button:hover { background: #383838; color: var(--accent); }
</style>
