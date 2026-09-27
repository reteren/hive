<script lang="ts">
  import { onMount, tick } from "svelte";
  import { camera, viewport } from "../board/camera.svelte";
  import { worldToScreen, type Point } from "../board/cameraMath";
  import { board } from "../model/board.svelte";
  import type { Note } from "../model/note";
  import { teleportToObject } from "../navigation/navigate";
  import { searchNotes } from "../search/matching";
  import { activeDropTarget, registerDropTarget, type DropTargetMatch } from "../selection/dropTargets";
  import { addListTarget, addListTargetCommand, addListText, removeListRow, reorderListRow } from "./actions.svelte";
  import { listItemDisplay } from "./logic";

  let { note }: { note: Note } = $props();
  let root: HTMLDivElement | undefined = $state();
  let searchInput: HTMLInputElement | undefined = $state();
  let adding = $state(false);
  let query = $state("");
  let insertionIndex = $state<number | null>(null);
  let drag: { pointerId: number; itemId: string; startY: number; moved: boolean } | null = null;
  let items = $derived(note.listItems ?? []);
  let dropIndex = $derived($activeDropTarget?.targetId === note.id
    ? (($activeDropTarget.payload as { index?: number } | undefined)?.index ?? null)
    : null);
  let choices = $derived.by(() => {
    const candidates = board.order.flatMap((id) => {
      const item = board.notes[id];
      return item && id !== note.id ? [{ id, name: item.name, text: item.text, type: item.type }] : [];
    });
    if (!query.trim()) return candidates.slice(0, 20);
    const ids = [...new Set(searchNotes(query, candidates, board.order)
      .filter((result) => result.kind === "name").map((result) => result.noteId))];
    return ids.slice(0, 20).flatMap((id) => candidates.find((item) => item.id === id) ?? []);
  });

  onMount(() => registerDropTarget({
    ownerId: note.id,
    accepts: (noteIds, worldPoint) => findDropTarget(noteIds, worldPoint),
    drop: (noteIds, match) => {
      const targetId = noteIds[0];
      if (!targetId) return null;
      const index = (match.payload as { index?: number } | undefined)?.index;
      return addListTargetCommand(note.id, targetId, index);
    },
  }));

  onMount(() => {
    const onEscape = (event: KeyboardEvent): void => {
      if (event.key !== "Escape" || !drag) return;
      event.preventDefault();
      cancelReorder();
    };
    document.addEventListener("keydown", onEscape);
    return () => document.removeEventListener("keydown", onEscape);
  });

  function findDropTarget(noteIds: readonly string[], worldPoint: Point): DropTargetMatch | null {
    if (noteIds.length !== 1 || !root || noteIds[0] === note.id || !board.notes[noteIds[0]]) return null;
    const boardRect = root.closest<HTMLElement>(".board")?.getBoundingClientRect();
    if (!boardRect) return null;
    const screen = worldToScreen(camera, viewport, worldPoint);
    const x = boardRect.left + screen.x;
    const y = boardRect.top + screen.y;
    const rect = root.closest<HTMLElement>(".note-card")?.getBoundingClientRect() ?? root.getBoundingClientRect();
    if (x < rect.left || x > rect.right || y < rect.top || y > rect.bottom) return null;
    return { targetId: note.id, ownerId: note.id, payload: { index: insertionSlot(y) } };
  }

  function insertionSlot(clientY: number): number {
    const rows = [...(root?.querySelectorAll<HTMLElement>("[data-list-row]") ?? [])];
    const slot = rows.findIndex((row) => clientY < row.getBoundingClientRect().top + row.getBoundingClientRect().height / 2);
    return slot < 0 ? rows.length : slot;
  }

  function addTarget(targetId: string): void {
    if (addListTarget(note.id, targetId)) {
      query = "";
      adding = false;
    }
  }

  function addText(): void {
    if (addListText(note.id, query)) {
      query = "";
      adding = false;
    }
  }

  function openPicker(): void {
    adding = true;
    void tick().then(() => searchInput?.focus());
  }

  function handleSearchKeydown(event: KeyboardEvent): void {
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      adding = false;
      query = "";
    } else if (event.key === "Enter" && query.trim()) {
      event.preventDefault();
      event.stopPropagation();
      addText();
    }
  }

  function beginReorder(itemId: string, event: PointerEvent): void {
    if (event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    drag = { pointerId: event.pointerId, itemId, startY: event.clientY, moved: false };
    (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
  }

  function moveReorder(event: PointerEvent): void {
    if (!drag || drag.pointerId !== event.pointerId) return;
    if (Math.abs(event.clientY - drag.startY) > 4) drag.moved = true;
    if (drag.moved) insertionIndex = insertionSlot(event.clientY);
  }

  function endReorder(event: PointerEvent): void {
    if (!drag || drag.pointerId !== event.pointerId) return;
    if (drag.moved && insertionIndex !== null) reorderListRow(note.id, drag.itemId, insertionIndex);
    drag = null;
    insertionIndex = null;
  }

  function cancelReorder(): void {
    drag = null;
    insertionIndex = null;
  }

  function reorderByKeyboard(itemId: string, index: number, event: KeyboardEvent): void {
    if (event.key !== "ArrowUp" && event.key !== "ArrowDown") return;
    event.preventDefault();
    const target = event.key === "ArrowUp" ? index - 1 : index + 2;
    reorderListRow(note.id, itemId, target);
  }
</script>

<div class="list-body note-body" data-list-node={note.id} data-selection-ignore bind:this={root} class:drop-target={$activeDropTarget?.targetId === note.id}>
  {#if items.length === 0}<p class="list-empty">Add links or text to this List.</p>{/if}
  <div class="list-rows">
    {#each items as item, index (item.id)}
      {@const display = listItemDisplay(item, board.notes)}
      <div class="list-row" data-list-row={item.id} class:missing={display.missing} class:insert-before={insertionIndex === index || dropIndex === index}>
        <button class="list-grip" type="button" data-list-reorder={item.id} aria-label={`Drag to reorder ${display.label}`}
          onpointerdown={(event) => beginReorder(item.id, event)} onpointermove={moveReorder}
          onpointerup={endReorder} onpointercancel={cancelReorder} onlostpointercapture={cancelReorder}
          onkeydown={(event) => reorderByKeyboard(item.id, index, event)}>⋮⋮</button>
        {#if item.targetId && !display.missing}
          <button class="list-link" type="button" data-list-target={item.targetId}
            onclick={() => teleportToObject(item.targetId!, { label: "Open List item" })}>{display.label}</button>
        {:else}
          <span class="list-label">{display.label}</span>
        {/if}
        {#if display.missing}<span class="list-missing">missing</span>{/if}
        <button class="list-remove" type="button" data-list-remove={item.id} aria-label={`Remove ${display.label}`}
          onclick={() => removeListRow(note.id, item.id)}>×</button>
      </div>
    {/each}
    {#if insertionIndex === items.length || dropIndex === items.length}<div class="list-end-slot" aria-hidden="true"></div>{/if}
  </div>
  {#if adding}
    <div class="list-picker" data-list-picker>
      <input data-list-search aria-label="Search board objects or type text" placeholder="Search board objects or type text"
        bind:this={searchInput} bind:value={query} onkeydown={handleSearchKeydown} />
      <div class="list-picker-results">
        {#each choices as choice (choice.id)}
          <button type="button" data-list-target-option={choice.id} onclick={() => addTarget(choice.id)}>{choice.name}</button>
        {:else}
          {#if query.trim()}<span class="list-picker-empty">No matching board object.</span>{/if}
        {/each}
      </div>
      <div class="list-picker-actions">
        <button type="button" data-list-add-text disabled={!query.trim()} onclick={addText}>Add text row</button>
        <button type="button" onclick={() => { adding = false; query = ""; }}>Cancel</button>
      </div>
    </div>
  {:else}
    <button class="list-add" type="button" data-list-add onclick={openPicker}>+ Add</button>
  {/if}
</div>

<style>
  .list-body { display: grid; min-width: 0; gap: 6px; padding: 2px; font-size: 11px; }
  .list-body.drop-target { outline: 2px solid var(--accent); outline-offset: -2px; background: #f5cd4d12; }
  .list-empty { margin: 0; padding: 6px; color: var(--text-dim); }
  .list-rows { display: grid; gap: 2px; }
  .list-row { display: flex; min-width: 0; min-height: 26px; align-items: center; gap: 4px; border: 1px solid #41444a; border-radius: 3px; background: #24262b; }
  .list-row.insert-before { border-top: 2px solid var(--accent); }
  .list-row.missing { color: #898b90; background: #202125; }
  .list-grip, .list-remove { flex: none; border: 0; color: #9da0a6; background: transparent; cursor: pointer; }
  .list-grip { width: 22px; height: 25px; padding: 0; font-size: 13px; cursor: grab; touch-action: none; }
  .list-grip:active { cursor: grabbing; }
  .list-link, .list-label { min-width: 0; flex: 1; overflow: hidden; padding: 3px 0; color: var(--text); font: inherit; text-align: left; text-overflow: ellipsis; white-space: nowrap; }
  .list-link { border: 0; background: transparent; cursor: pointer; }
  .list-link:hover { color: var(--accent); text-decoration: underline; }
  .list-label { color: inherit; }
  .list-missing { flex: none; color: #a0a2a7; font-size: 10px; }
  .list-remove { width: 23px; height: 23px; font-size: 16px; }
  .list-remove:hover { color: #f0b6b6; }
  .list-end-slot { height: 2px; background: var(--accent); }
  .list-add, .list-picker button { padding: 5px 7px; border: 1px solid #53565e; border-radius: 3px; color: var(--text); background: #2c2e34; font: inherit; cursor: pointer; }
  .list-add { text-align: left; }
  .list-picker { display: grid; gap: 5px; padding: 5px; border: 1px solid #4d5057; border-radius: 3px; background: #222429; }
  .list-picker input { min-width: 0; width: 100%; box-sizing: border-box; padding: 5px; border: 1px solid #646871; border-radius: 3px; color: var(--text); background: #191a1e; font: inherit; }
  .list-picker-results { display: grid; max-height: 130px; overflow: auto; gap: 2px; }
  .list-picker-results button { text-align: left; }
  .list-picker-empty { color: var(--text-dim); }
  .list-picker-actions { display: flex; gap: 4px; }
  .list-picker button:disabled { opacity: 0.4; cursor: default; }
  .list-picker button:hover:not(:disabled), .list-add:hover { border-color: var(--accent); }
</style>
