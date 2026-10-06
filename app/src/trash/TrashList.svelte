<script lang="ts">
  import { listTrashEntries, previewRestore, restoreTrashEntry, deletePermanently, emptyTrash } from "./trashActions.svelte";
  import type { TrashListItem, TrashRestorePreview } from "./trashActions.svelte";
  import { ME_OBJECT_ID } from "../model/link";
  import { board } from "../model/board.svelte";
  import { summarizeTrashEntry } from "./trashListModel";

  let { compact = false }: { compact?: boolean } = $props();
  let entries = $derived(listTrashEntries());
  let restorePreview = $state<{ entry: TrashListItem; report: TrashRestorePreview } | null>(null);
  let pendingDelete = $state<TrashListItem | null>(null);
  let confirmingEmpty = $state(false);
  let deleteCancelButton = $state<HTMLButtonElement | null>(null);
  let emptyCancelButton = $state<HTMLButtonElement | null>(null);

  $effect(() => {
    if (!pendingDelete || !deleteCancelButton) return;
    const frame = requestAnimationFrame(() => deleteCancelButton?.focus());
    return () => cancelAnimationFrame(frame);
  });

  $effect(() => {
    if (!confirmingEmpty || !emptyCancelButton) return;
    const frame = requestAnimationFrame(() => emptyCancelButton?.focus());
    return () => cancelAnimationFrame(frame);
  });

  function requestRestore(entry: TrashListItem): void {
    const report = previewRestore(entry.id);
    if (!report) return;
    if (needsPreview(report)) {
      restorePreview = { entry, report };
      return;
    }

    restoreTrashEntry(entry.id);
    restorePreview = null;
  }

  function confirmRestore(): void {
    if (!restorePreview) return;
    const current = previewRestore(restorePreview.entry.id);
    if (!current) {
      restorePreview = null;
      return;
    }
    if (needsPreview(current) && !samePreview(current, restorePreview.report)) {
      restorePreview.report = current;
      return;
    }

    const result = restoreTrashEntry(restorePreview.entry.id);
    if (result?.idConflicts.length) {
      restorePreview.report = result;
      return;
    }
    restorePreview = null;
  }

  function confirmDelete(): void {
    if (!pendingDelete) return;
    deletePermanently(pendingDelete.id);
    pendingDelete = null;
  }

  function handleDeleteConfirmKeydown(event: KeyboardEvent): void {
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      pendingDelete = null;
    } else if (event.key === "Enter") {
      event.preventDefault();
      event.stopPropagation();
      confirmDelete();
    }
  }

  function confirmEmpty(): void {
    emptyTrash();
    confirmingEmpty = false;
  }

  function handleEmptyConfirmKeydown(event: KeyboardEvent): void {
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      confirmingEmpty = false;
    } else if (event.key === "Enter") {
      event.preventDefault();
      event.stopPropagation();
      confirmEmpty();
    }
  }

  function formatTime(value: number): string {
    if (!Number.isFinite(value)) return "Unknown date";
    return new Date(value).toLocaleString(undefined, { dateStyle: "short", timeStyle: "short" });
  }

  function datetimeAttribute(value: number): string {
    return Number.isFinite(value) ? new Date(value).toISOString() : "";
  }

  function iconKind(entry: TrashListItem): string {
    return summarizeTrashEntry(entry).kind;
  }

  function needsPreview(report: TrashRestorePreview): boolean {
    return report.linksBroken.length > 0 || report.renamed.length > 0 || report.idConflicts.length > 0;
  }

  function samePreview(first: TrashRestorePreview, second: TrashRestorePreview): boolean {
    return JSON.stringify({
      linksRestored: first.linksRestored.map((link) => link.id),
      linksBroken: first.linksBroken.map(({ link, missingEndpoints, reason }) => ({ id: link.id, missingEndpoints, reason })),
      renamed: first.renamed.map(({ noteId, from, to }) => ({ noteId, from, to })),
      idConflicts: first.idConflicts,
    }) === JSON.stringify({
      linksRestored: second.linksRestored.map((link) => link.id),
      linksBroken: second.linksBroken.map(({ link, missingEndpoints, reason }) => ({ id: link.id, missingEndpoints, reason })),
      renamed: second.renamed.map(({ noteId, from, to }) => ({ noteId, from, to })),
      idConflicts: second.idConflicts,
    });
  }

  function noteName(noteId: string, entry: TrashListItem): string {
    if (noteId === ME_OBJECT_ID) return "ME";
    return entry.notes.find((note) => note.id === noteId)?.name
      ?? board.notes[noteId]?.name
      ?? `Missing ${noteId.slice(0, 8)}`;
  }

  function brokenLinkSummary(
    item: TrashRestorePreview["linksBroken"][number],
    entry: TrashListItem,
  ): string {
    const link = item.link;
    const ends = `${noteName(link.from, entry)} → ${noteName(link.to, entry)}`;
    if (item.missingEndpoints.length) {
      const missing = item.missingEndpoints.map((id) => noteName(id, entry)).join(", ");
      return `${ends} · missing ${missing}`;
    }
    return item.reason === "link-id-exists"
      ? `${ends} · link already exists`
      : `${ends} · connection already exists`;
  }
</script>

<section class:compact class="trash-list" data-trash-list data-selection-ignore aria-label="Trash entries">
  <div class="trash-entries">
    {#each entries as entry (entry.id)}
      {@const summary = summarizeTrashEntry(entry)}
      <article class="trash-entry" data-trash-entry={entry.id}>
        <span class="trash-kind-icon" data-kind={iconKind(entry)} aria-hidden="true"></span>
        <div class="trash-entry-content">
          <div class="trash-entry-heading">
            <strong class="trash-entry-name" title={summary.label}>{summary.label}</strong>
            <time datetime={datetimeAttribute(entry.deletedAt)}>{formatTime(entry.deletedAt)}</time>
          </div>
          <div class="trash-entry-actions">
            <button type="button" class="trash-action" onclick={() => requestRestore(entry)}>Restore</button>
            <button type="button" class="trash-action danger" onclick={() => (pendingDelete = entry)}>Delete permanently</button>
          </div>

          {#if restorePreview && restorePreview.entry.id === entry.id}
            <div class="trash-confirm" role="alert" aria-label={`Preview restoring ${summary.label}`}>
              <strong>Restore preview</strong>
              {#if restorePreview.report.linksRestored.length > 0}
                <p>{restorePreview.report.linksRestored.length} link{restorePreview.report.linksRestored.length === 1 ? "" : "s"} will be restored.</p>
              {/if}
              {#if restorePreview.report.linksBroken.length > 0}
                <p>These links will stay broken:</p>
                <ul>
                  {#each restorePreview.report.linksBroken as link, index (`${link.link.id}:${index}`)}
                    <li>{brokenLinkSummary(link, entry)}</li>
                  {/each}
                </ul>
              {/if}
              {#if restorePreview.report.renamed.length > 0}
                <p>Names will change to avoid conflicts:</p>
                <ul>
                  {#each restorePreview.report.renamed as rename (`${rename.from}:${rename.to}`)}
                    <li>{rename.from} → {rename.to}</li>
                  {/each}
                </ul>
              {/if}
              {#if restorePreview.report.idConflicts.length > 0}
                <p>This entry cannot be restored because an object with the same identity already exists.</p>
                <ul>
                  {#each restorePreview.report.idConflicts as noteId (noteId)}
                    <li>{noteName(noteId, entry)}</li>
                  {/each}
                </ul>
              {/if}
              <div class="trash-confirm-actions">
                <button type="button" class="trash-action" onclick={() => (restorePreview = null)}>Cancel</button>
                {#if restorePreview.report.idConflicts.length === 0}
                  <button type="button" class="trash-action primary" onclick={confirmRestore}>Confirm restore</button>
                {/if}
              </div>
            </div>
          {/if}

          {#if pendingDelete?.id === entry.id}
            <div class="trash-confirm" data-trash-delete-confirm role="dialog" aria-modal="false" aria-label={`Confirm permanent deletion of ${summary.label}`} tabindex="-1" onkeydown={handleDeleteConfirmKeydown}>
              <p>Delete “<strong>{summary.label}</strong>” permanently? This cannot be undone.</p>
              <div class="trash-confirm-actions">
                <button bind:this={deleteCancelButton} type="button" class="trash-action" data-trash-delete-cancel onclick={() => (pendingDelete = null)}>Cancel</button>
                <button type="button" class="trash-action danger" data-trash-delete-confirm-action onclick={confirmDelete}>Delete</button>
              </div>
            </div>
          {/if}
        </div>
      </article>
    {:else}
      <p class="empty-state">Trash is empty.</p>
    {/each}
  </div>

  {#if confirmingEmpty}
    <div class="trash-empty-confirm" data-trash-empty-confirm role="dialog" aria-modal="false" aria-label="Confirm empty trash" tabindex="-1" onkeydown={handleEmptyConfirmKeydown}>
      <span>Permanently delete all {entries.length} {entries.length === 1 ? "entry" : "entries"}? This cannot be undone.</span>
      <div class="trash-confirm-actions">
        <button bind:this={emptyCancelButton} type="button" class="trash-action" data-trash-empty-cancel onclick={() => (confirmingEmpty = false)}>Cancel</button>
        <button type="button" class="trash-action danger" onclick={confirmEmpty}>Empty trash</button>
      </div>
    </div>
  {/if}

  <footer class="trash-list-footer">
    <span>{entries.length} {entries.length === 1 ? "entry" : "entries"}</span>
    <button type="button" class="trash-action danger" disabled={entries.length === 0} onclick={() => (confirmingEmpty = true)}>
      Empty trash
    </button>
  </footer>
</section>

<style>
  .trash-list {
    display: flex;
    flex: 1 1 auto;
    min-height: 0;
    flex-direction: column;
    color: var(--text);
  }

  .trash-entries {
    flex: 1 1 auto;
    min-height: 0;
    overflow: auto;
    scrollbar-width: thin;
  }

  .trash-entry {
    display: grid;
    grid-template-columns: 16px minmax(0, 1fr);
    gap: 6px;
    padding: 6px;
    border-bottom: 1px solid #353535;
  }

  .trash-kind-icon {
    position: relative;
    display: grid;
    width: 13px;
    height: 13px;
    margin-top: 2px;
    place-items: center;
    border: 1px solid #909090;
    border-radius: 2px;
    background: var(--bg-panel-raised);
    color: #c4c4c4;
    font-size: 7px;
    font-weight: 700;
    line-height: 1;
  }

  .trash-kind-icon::after {
    content: "N";
  }

  .trash-kind-icon[data-kind="importance"]::after { content: "I"; }
  .trash-kind-icon[data-kind="purpose"]::after { content: "P"; }
  .trash-kind-icon[data-kind="mood"]::after { content: "M"; }
  .trash-kind-icon[data-kind="goal"]::after { content: "G"; }
  .trash-kind-icon[data-kind="progress"]::after { content: "%"; }
  .trash-kind-icon[data-kind="calculator"]::after { content: "C"; }
  .trash-kind-icon[data-kind="tierlist"]::after { content: "T"; }
  .trash-kind-icon[data-kind="stats"]::after { content: "#"; }
  .trash-kind-icon[data-kind="archive"]::after { content: "A"; }
  .trash-kind-icon[data-kind="trash"]::after { content: "×"; }
  .trash-kind-icon[data-kind="objects"]::after { content: "3"; }
  .trash-kind-icon[data-kind="beacon"] {
    border-color: var(--icon);
    border-radius: 50%;
    background: var(--icon);
    box-shadow: inset 0 0 0 3px var(--bg-panel);
  }

  .trash-kind-icon[data-kind="beacon"]::after { content: ""; }

  .trash-kind-icon[data-kind="zone"] {
    border-color: #81ad94;
    border-style: dashed;
    background: #24352a;
  }

  .trash-kind-icon[data-kind="zone"]::after { content: ""; }

  .trash-kind-icon[data-kind="pro"]::after,
  .trash-kind-icon[data-kind="con"]::after {
    position: absolute;
    inset: -2px 0 0;
    color: #9ccda2;
    content: "+";
    font-size: 12px;
    font-weight: 700;
    line-height: 13px;
    text-align: center;
  }

  .trash-kind-icon[data-kind="con"]::after {
    color: #e19a94;
    content: "−";
  }

  .trash-entry-content {
    min-width: 0;
  }

  .trash-entry-heading {
    display: flex;
    min-width: 0;
    align-items: baseline;
    justify-content: space-between;
    gap: 5px;
  }

  .trash-entry-name {
    min-width: 0;
    overflow: hidden;
    font-size: 10px;
    font-weight: 550;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  time {
    flex: 0 0 auto;
    color: var(--text-dim);
    font-size: 8px;
    font-variant-numeric: tabular-nums;
  }

  .trash-entry-actions,
  .trash-confirm-actions {
    display: flex;
    flex-wrap: wrap;
    gap: 4px;
    margin-top: 4px;
  }

  .trash-action {
    min-height: 22px;
    padding: 2px 6px;
    border: 1px solid #444;
    border-radius: 2px;
    background: var(--bg-panel-raised);
    color: var(--text-dim);
    font: inherit;
    font-size: 9px;
    cursor: pointer;
  }

  .trash-action:hover,
  .trash-action:focus-visible {
    border-color: #777;
    color: var(--text);
  }

  .trash-action.primary {
    border-color: rgba(var(--accent-rgb), 0.45);
    color: var(--accent);
  }

  .trash-action.danger {
    color: #e2a19a;
  }

  .trash-action.danger:hover,
  .trash-action.danger:focus-visible {
    border-color: #985b55;
    background: #382725;
  }

  .trash-action:disabled {
    opacity: 0.45;
    cursor: default;
  }

  .trash-confirm,
  .trash-empty-confirm {
    margin-top: 5px;
    padding: 6px;
    border: 1px solid #6c5144;
    border-radius: 3px;
    background: #302723;
    color: var(--text);
    font-size: 9px;
    line-height: 1.4;
  }

  .trash-confirm p {
    margin: 3px 0;
  }

  .trash-confirm ul {
    max-height: 75px;
    overflow: auto;
    margin: 2px 0 4px;
    padding-left: 17px;
    color: var(--text-dim);
  }

  .trash-list-footer {
    display: flex;
    min-height: 29px;
    align-items: center;
    justify-content: space-between;
    gap: 5px;
    padding: 4px 6px;
    border-top: 1px solid #3b3b3b;
    color: var(--text-dim);
    font-size: 9px;
  }

  .empty-state {
    margin: 0;
    padding: 10px 8px;
    color: var(--text-dim);
    font-size: 10px;
  }

  .compact .trash-entries {
    max-height: 235px;
  }

  .compact .trash-entry {
    padding: 4px 2px;
  }

  .compact .trash-entry-heading {
    align-items: flex-start;
    flex-direction: column;
    gap: 1px;
  }
</style>
