<script lang="ts">
  import { camera } from "../board/camera.svelte";
  import { calculators } from "../calculator/calculators.svelte";
  import { board } from "../model/board.svelte";
  import { links } from "../model/links.svelte";
  import type { Note } from "../model/note";
  import { archive, type ArchiveEntry } from "../model/retention.svelte";
  import { deleteArchivedPermanently, duplicateArchivedNear, restoreArchived } from "./actions.svelte";
  import { planArchiveRestore } from "./logic";

  let { note }: { note: Note } = $props();
  let feedback = $state("");
  let items = $derived.by(() => {
    const activeNotes = Object.values(board.notes);
    const activeLinks = Object.values(links.byId);
    const activeCalculatorKeys = Object.keys(calculators.byKey);
    return [...archive.entries].reverse().map((entry) => ({
      entry,
      idConflict: Boolean(board.notes[entry.note.id]),
      oldPlan: planArchiveRestore(entry, "old", camera, activeNotes, activeLinks, activeCalculatorKeys),
      centrePlan: planArchiveRestore(entry, "centre", camera, activeNotes, activeLinks, activeCalculatorKeys),
    }));
  });

  function kindIcon(item: Note): string {
    if (item.task) return "✓";
    const icons: Record<string, string> = {
      note: "N", pro: "+", con: "−", importance: "!", purpose: "P", mood: "M",
      goal: "G", progress: "%", calculator: "Σ", tierlist: "≡", stats: "#",
    };
    return icons[item.type] ?? "N";
  }

  function previewText(item: Note): string {
    return item.text.trim().replace(/\s+/g, " ").slice(0, 110) || "No text preview";
  }

  function otherEnd(link: ArchiveEntry["links"][number], item: Note): string {
    const id = link.from === item.id ? link.to : link.from;
    if (id === "me") return "ME";
    return board.notes[id]?.name ?? archive.entries.find((entry) => entry.note.id === id)?.note.name ?? id;
  }

  function restore(entry: ArchiveEntry, placement: "old" | "centre"): void {
    const result = restoreArchived(entry.id, placement);
    feedback = result
      ? result.nameChanged ? `Restored as ${result.note.name}.` : `Restored ${result.note.name}.`
      : "This item cannot be restored while its original ID is in use.";
  }

  function duplicate(entry: ArchiveEntry): void {
    const copy = duplicateArchivedNear(entry.id, note.id);
    feedback = copy ? `Created ${copy.name} beside Archive.` : "Could not duplicate this item.";
  }

  function deletePermanently(entry: ArchiveEntry): void {
    if (!window.confirm(`Delete ${entry.note.name} permanently from Archive? This cannot be undone.`)) return;
    deleteArchivedPermanently(entry.id);
    feedback = `Deleted ${entry.note.name} permanently.`;
  }
</script>

<div class="archive-body" data-archive-node={note.id} data-selection-ignore role="region" aria-label="Project archive">
  <div class="archive-heading"><strong>Archive</strong><span>{archive.entries.length} items</span></div>
  {#if feedback}<p class="archive-feedback" data-archive-feedback role="status">{feedback}</p>{/if}
  {#if items.length === 0}
    <p class="archive-empty">Archived nodes appear here.</p>
  {:else}
    <div class="archive-list">
      {#each items as item (item.entry.id)}
        {@const entry = item.entry}
        <section class="archive-item" data-archive-entry={entry.id}>
          <div class="archive-item-heading">
            <span class="archive-kind" title={entry.note.task ? "Task" : entry.note.type} aria-label={entry.note.task ? "Task" : entry.note.type}>{kindIcon(entry.note)}</span>
            <strong class="archive-name">{entry.note.name}</strong>
            <time datetime={new Date(entry.archivedAt).toISOString()}>{new Date(entry.archivedAt).toLocaleString()}</time>
          </div>
          <p class="archive-preview">{previewText(entry.note)}</p>
          {#if item.idConflict}<p class="archive-notice">Original ID is in use; restore is unavailable.</p>{/if}
          {#if item.oldPlan.nameChanged}<p class="archive-notice">Restore will rename to {item.oldPlan.note.name}.</p>{/if}
          {#if item.oldPlan.calculatorUsesLiveData}<p class="archive-notice">A calculator with this name is active; restore will use its current data.</p>{/if}
          {#if item.oldPlan.placeOccupied}<p class="archive-notice">Old place is occupied; restored node will overlap.</p>{/if}
          {#if item.centrePlan.placeOccupied}<p class="archive-notice">Screen centre is occupied; centre restore will overlap.</p>{/if}
          {#if entry.links.length > 0}
            <details class="archive-links" data-archive-links>
              <summary>{item.oldPlan.links.length} links return · {item.oldPlan.missingLinks.length} unavailable</summary>
              <ul>
                {#each item.oldPlan.links as link (link.id)}<li>Returns: {otherEnd(link, entry.note)}</li>{/each}
                {#each item.oldPlan.missingLinks as link (link.id)}<li>Unavailable: {otherEnd(link, entry.note)}</li>{/each}
              </ul>
            </details>
          {/if}
          <div class="archive-actions">
            <button type="button" data-archive-restore-old disabled={item.idConflict} onclick={() => restore(entry, "old")}>Restore to old place</button>
            <button type="button" data-archive-restore-centre disabled={item.idConflict} onclick={() => restore(entry, "centre")}>Restore to screen centre</button>
            <button type="button" data-archive-duplicate onclick={() => duplicate(entry)}>Duplicate near Archive</button>
            <button type="button" class="danger" data-archive-delete onclick={() => deletePermanently(entry)}>Delete permanently</button>
          </div>
        </section>
      {/each}
    </div>
  {/if}
</div>

<style>
  .archive-body { display: grid; min-width: 0; gap: 7px; font-size: 11px; }
  .archive-heading { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
  .archive-heading span, .archive-empty, .archive-preview, .archive-item time { color: var(--text-dim); }
  .archive-heading strong { color: var(--accent); font-size: 12px; }
  .archive-empty, .archive-feedback, .archive-preview, .archive-notice { margin: 0; }
  .archive-feedback { color: #d9cb92; }
  .archive-list { display: grid; max-height: 270px; overflow: auto; gap: 5px; }
  .archive-item { display: grid; gap: 5px; padding: 7px; border: 1px solid #49443a; border-radius: 4px; background: #22211f; }
  .archive-item-heading { display: flex; min-width: 0; align-items: center; gap: 6px; }
  .archive-kind { display: grid; width: 18px; height: 18px; flex: none; place-items: center; border: 1px solid #8c7944; border-radius: 3px; color: #e2c56d; font-weight: 700; }
  .archive-name { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .archive-item time { margin-left: auto; font-size: 9px; white-space: nowrap; }
  .archive-preview { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .archive-notice { color: #e6c979; font-size: 10px; }
  .archive-links { color: var(--text-dim); font-size: 10px; }
  .archive-links summary { cursor: pointer; }
  .archive-links ul { margin: 4px 0 0; padding-left: 16px; }
  .archive-actions { display: flex; flex-wrap: wrap; gap: 4px; }
  .archive-actions button { padding: 4px 6px; border: 1px solid #565044; border-radius: 3px; color: var(--text); background: #2c2a25; font: inherit; font-size: 10px; cursor: pointer; }
  .archive-actions button:hover:not(:disabled) { border-color: var(--accent); }
  .archive-actions button:disabled { opacity: 0.45; cursor: default; }
  .archive-actions .danger { color: #f0c2bd; border-color: #704344; }
</style>
