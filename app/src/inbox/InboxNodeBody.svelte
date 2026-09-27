<script lang="ts">
  import { board } from "../model/board.svelte";
  import { links } from "../model/links.svelte";
  import type { Note } from "../model/note";
  import { teleportToObject } from "../navigation/navigate";
  import { resolveInboxTwin } from "./inbox.svelte";
  import { formatInboxEntryTime } from "./inboxLogic";
  import { INBOX_ROW_HEIGHT } from "./inboxLayout";

  let { note }: { note: Note } = $props();
  let entries = $derived.by(() => {
    const order = new Map(board.order.map((id, index) => [id, index]));
    const linked = Object.values(links.byId).flatMap((link) => {
      if (link.from !== note.id || link.kind !== "strong") return [];
      const target = board.notes[link.to];
      return target ? [{ note: target, order: order.get(target.id) ?? -1 }] : [];
    });
    linked.sort((first, second) => (second.note.createdAt ?? 0) - (first.note.createdAt ?? 0) || second.order - first.order);
    return { count: linked.length, entries: linked.map(({ note: target }) => target) };
  });

  function openEntry(target: Note): void {
    resolveInboxTwin(target.id);
    teleportToObject(target.id, { label: "Open Inbox entry" });
  }

  function entryDateTime(createdAt: number | undefined): string | undefined {
    if (createdAt === undefined || !Number.isFinite(createdAt)) return undefined;
    const date = new Date(createdAt);
    return Number.isFinite(date.getTime()) ? date.toISOString() : undefined;
  }
</script>

<section class="inbox-body" data-inbox-node={note.id} aria-label={`Inbox ${note.name}`} style:--inbox-row-height={`${INBOX_ROW_HEIGHT * 10}px`}>
  <header class="inbox-heading">
    <strong>Inbox</strong>
    <span data-inbox-entry-count>{entries.count} {entries.count === 1 ? "entry" : "entries"}</span>
  </header>
  {#if entries.entries.length > 0}
    <ul class="inbox-entry-list" data-inbox-entry-list>
      {#each entries.entries as entry (entry.id)}
        <li>
          <button type="button" data-inbox-entry={entry.id} data-selection-ignore title={entry.name} onclick={() => openEntry(entry)}>
            <span class="inbox-entry-name" data-inbox-entry-name>{entry.name}</span>
            <time class="inbox-entry-time" data-inbox-entry-time datetime={entryDateTime(entry.createdAt)}>
              {formatInboxEntryTime(entry.createdAt)}
            </time>
          </button>
        </li>
      {/each}
    </ul>
  {/if}
</section>

<style>
  :global(.note-card[data-kind="inbox"] .note-content) { min-height: 0; overflow: hidden; }
  .inbox-body {
    display: grid;
    width: 100%;
    height: 100%;
    min-width: 0;
    min-height: 0;
    grid-template-rows: auto minmax(0, 1fr);
    gap: 5px;
    font-size: 11px;
  }
  .inbox-heading { display: flex; align-items: baseline; justify-content: space-between; gap: 8px; }
  .inbox-heading strong { color: var(--accent); font-size: 12px; }
  .inbox-heading span { margin: 0; color: var(--text-dim); font-size: 10px; }
  .inbox-entry-list {
    display: grid;
    min-height: 0;
    align-content: start;
    gap: 0;
    overflow-y: auto;
    overscroll-behavior: contain;
    margin: 0;
    padding: 0;
    list-style: none;
  }
  .inbox-entry-list button {
    display: grid;
    min-height: var(--inbox-row-height);
    grid-template-columns: minmax(0, 1fr) auto;
    align-items: center;
    gap: 7px;
    width: 100%;
    overflow: hidden;
    padding: 3px 4px;
    border: 0;
    border-radius: 2px;
    color: var(--text);
    background: transparent;
    font: inherit;
    text-align: left;
    cursor: pointer;
  }
  .inbox-entry-name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .inbox-entry-time { color: var(--text-dim); font-size: 9px; white-space: nowrap; }
  .inbox-entry-list button:hover { background: #383838; color: var(--accent); }
</style>
