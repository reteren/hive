<script lang="ts">
  import { onMount, tick } from "svelte";
  import { flip } from "svelte/animate";
  import { get } from "svelte/store";
  import { camera, viewport } from "../board/camera.svelte";
  import { worldToScreen, type Point } from "../board/cameraMath";
  import { board } from "../model/board.svelte";
  import { zones } from "../model/zones.svelte";
  import { zoneBounds } from "../model/zone";
  import type { Note } from "../model/note";
  import type { ListItem } from "../model/nodeData";
  import { execute } from "../history/history.svelte";
  import { teleportToObject, teleportToPoint } from "../navigation/navigate";
  import { selectZonesOnly } from "../selection/selection.svelte";
  import { preferences } from "../settings/preferences.svelte";
  import { searchNotes } from "../search/matching";
  import { dismissBoardPopup } from "../ui/boardAnchor";
  import { activeDropTarget, registerDropTarget, type DropTargetMatch } from "../selection/dropTargets";
  import { addListTarget, addListTargetCommand, addListText, removeListRow, reorderListRow } from "./actions.svelte";
  import { listItemDisplay, listInsertionIndexAt } from "./logic";
  import { listItemKind } from "./icons";
  import ListKindIcon from "./ListKindIcon.svelte";
  import ListStatsExtension from "../stats/ListStatsExtension.svelte";
  import { beginContentDrag, clearContentDrag, contentDragPreview, previewContentDrop, registerContentDropTarget, type ContentSource } from "./itemDrag";
  import { createContentMoveCommand } from "./transfers.svelte";
  import { listPickerInput } from "./pickerInput";

  let { note }: { note: Note } = $props();
  let root: HTMLDivElement | undefined = $state();
  let rowContainer: HTMLDivElement | undefined = $state();
  let searchInput: HTMLInputElement | undefined = $state();
  let adding = $state(false);
  let query = $state("");
  let drag: { pointerId: number; itemId: string; start: Point; moved: boolean; clone: HTMLElement; width: number; height: number; scale: number; offset: Point } | null = null;
  let ghost: HTMLElement | null = null;
  const slotKey = Symbol("list drop slot");
  let items = $derived(note.listItems ?? []);
  let preview = $derived($contentDragPreview);
  let ownSource = $derived(preview?.source.kind === "list" && preview.source.noteId === note.id ? preview.source.itemId : null);
  let ownTarget = $derived(preview?.target?.kind === "list" && preview.target.noteId === note.id ? preview.target : null);
  let visibleRows = $derived.by(() => {
    const result: Array<{ id: string | symbol; item: ListItem | null }> = items.filter((item) => item.id !== ownSource).map((item) => ({ id: item.id, item }));
    if (ownTarget) result.splice(ownTarget.index, 0, { id: slotKey, item: null });
    return result;
  });
  let dropIndex = $derived($activeDropTarget?.targetId === note.id
    ? (($activeDropTarget.payload as { index?: number } | undefined)?.index ?? null) : null);
  let choices = $derived.by(() => {
    const candidates = [...board.order.flatMap((id) => {
      const item = board.notes[id];
      return item && id !== note.id ? [{ id, name: item.name, text: item.text }] : [];
    }), ...zones.order.flatMap((id) => zones.byId[id] ? [{ id, name: zones.byId[id].name, text: "" }] : [])];
    if (!query.trim()) return candidates.slice(0, 20);
    const ids = searchNotes(query, candidates).filter((result) => result.kind === "name").map((result) => result.noteId);
    return ids.slice(0, 20).flatMap((id) => candidates.find((item) => item.id === id) ?? []);
  });

  onMount(() => registerDropTarget({
    ownerId: note.id, accepts: findDropTarget,
    drop: (ids, match) => ids[0] ? addListTargetCommand(note.id, ids[0], (match.payload as { index?: number })?.index) : null,
  }));
  onMount(() => registerContentDropTarget((point, source) => {
    if (!root || document.elementFromPoint(point.x, point.y)?.closest(".note-card") !== root.closest(".note-card")) return null;
    return { kind: "list", noteId: note.id, index: insertionSlot(point.y, source) };
  }));
  onMount(() => {
    const escape = (event: KeyboardEvent): void => {
      if (event.key !== "Escape" || !drag) return;
      event.preventDefault(); event.stopPropagation(); cancelReorder();
    };
    document.addEventListener("keydown", escape, true);
    return () => { document.removeEventListener("keydown", escape, true); cancelReorder(); };
  });
  function findDropTarget(ids: readonly string[], point: Point): DropTargetMatch | null {
    if (ids.length !== 1 || !root || ids[0] === note.id || !board.notes[ids[0]]) return null;
    const boardRect = root.closest<HTMLElement>(".board")?.getBoundingClientRect();
    if (!boardRect) return null;
    const screen = worldToScreen(camera, viewport, point);
    const x = boardRect.left + screen.x, y = boardRect.top + screen.y;
    const rect = root.closest<HTMLElement>(".note-card")?.getBoundingClientRect() ?? root.getBoundingClientRect();
    if (x < rect.left || x > rect.right || y < rect.top || y > rect.bottom) return null;
    return { targetId: note.id, ownerId: note.id, payload: { index: insertionSlot(y) } };
  }
  function insertionSlot(clientY: number, source?: ContentSource): number {
    if (!rowContainer) return 0;
    // Untransformed heights exclude the preview gap and FLIP positions.
    const elements = [...rowContainer.querySelectorAll<HTMLElement>("[data-list-row]")];
    const heights = items.filter((item) => !(source?.kind === "list" && source.noteId === note.id && source.itemId === item.id))
      .map((item) => elements.find((row) => row.dataset.listRow === item.id)?.offsetHeight ?? 26);
    const scale = root ? root.getBoundingClientRect().width / Math.max(root.offsetWidth, 1) : 1;
    const active = get(contentDragPreview);
    const slot = active?.target?.kind === "list" && active.target.noteId === note.id
      ? { index: active.target.index, height: active.height } : undefined;
    return listInsertionIndexAt((clientY - rowContainer.getBoundingClientRect().top) / scale, heights, 2, slot);
  }
  function closePicker(): void { adding = false; query = ""; }
  function addTarget(id: string): void { if (addListTarget(note.id, id)) closePicker(); }
  function addText(): void { if (addListText(note.id, query)) closePicker(); }
  function openPicker(): void { adding = true; void tick().then(() => searchInput?.focus()); }
  function handleSearchKeydown(event: KeyboardEvent): void {
    event.stopPropagation();
    if (event.key === "Enter" && query.trim()) { event.preventDefault(); event.stopPropagation(); addText(); }
  }
  function openTarget(id: string): void {
    if (teleportToObject(id, { label: "Open List item" })) return;
    const zone = zones.byId[id];
    if (!zone) return;
    const b = zoneBounds(zone);
    teleportToPoint({ x: b.x + b.width / 2, y: b.y + b.height / 2 }, { label: "Open List zone" });
    selectZonesOnly([id]);
  }
  function beginReorder(itemId: string, event: PointerEvent): void {
    if (event.button !== 0 || !root || drag) return;
    const row = (event.currentTarget as HTMLElement).closest<HTMLElement>("[data-list-row]");
    if (!row) return;
    event.preventDefault(); event.stopPropagation();
    const rect = row.getBoundingClientRect();
    drag = { pointerId: event.pointerId, itemId, start: { x: event.clientX, y: event.clientY }, moved: false,
      clone: row.cloneNode(true) as HTMLElement, width: row.offsetWidth, height: row.offsetHeight,
      scale: rect.width / Math.max(row.offsetWidth, 1), offset: { x: event.clientX - rect.left, y: event.clientY - rect.top } };
    root.setPointerCapture(event.pointerId);
  }
  function moveReorder(event: PointerEvent): void {
    if (!drag || drag.pointerId !== event.pointerId) return;
    event.stopPropagation();
    const point = { x: event.clientX, y: event.clientY };
    if (!drag.moved && Math.hypot(point.x - drag.start.x, point.y - drag.start.y) < 4) return;
    event.preventDefault();
    if (!drag.moved) {
      drag.moved = true;
      beginContentDrag({ kind: "list", noteId: note.id, itemId: drag.itemId }, drag.height,
        { kind: "list", noteId: note.id, index: items.findIndex((item) => item.id === drag!.itemId) });
      ghost = drag.clone;
      ghost.dataset.listDragGhost = "";
      ghost.removeAttribute("data-list-row"); ghost.inert = true; ghost.setAttribute("aria-hidden", "true");
      Object.assign(ghost.style, { position: "fixed", zIndex: "2147483000", width: `${drag.width}px`, height: `${drag.height}px`,
        boxSizing: "border-box", fontSize: "11px", opacity: "0.5", pointerEvents: "none", transformOrigin: "top left", transform: `scale(${drag.scale})` });
      document.body.append(ghost);
    }
    if (ghost) { ghost.style.left = `${point.x - drag.offset.x}px`; ghost.style.top = `${point.y - drag.offset.y}px`; }
    previewContentDrop(point);
  }
  function endReorder(event: PointerEvent): void {
    if (!drag || drag.pointerId !== event.pointerId) return;
    event.stopPropagation();
    const target = drag.moved ? previewContentDrop({ x: event.clientX, y: event.clientY }) : null;
    const command = target ? createContentMoveCommand({ kind: "list", noteId: note.id, itemId: drag.itemId }, target) : null;
    cancelReorder(); if (command) execute(command);
  }
  function cancelReorder(): void {
    const active = drag; drag = null;
    ghost?.remove(); ghost = null;
    if (!active) return;
    clearContentDrag();
    if (root?.hasPointerCapture(active.pointerId)) root.releasePointerCapture(active.pointerId);
  }
  function cancelPointer(event: PointerEvent): void { if (drag?.pointerId === event.pointerId) cancelReorder(); }
  function reorderByKeyboard(id: string, index: number, event: KeyboardEvent): void {
    if (event.key !== "ArrowUp" && event.key !== "ArrowDown") return;
    event.preventDefault(); event.stopPropagation();
    reorderListRow(note.id, id, event.key === "ArrowUp" ? index - 1 : index + 2);
  }
</script>

<div class="list-body note-body" role="group" aria-label={`List ${note.name}`} data-list-node={note.id} data-selection-ignore bind:this={root}
  class:drop-target={$activeDropTarget?.targetId === note.id || !!ownTarget}
  onpointermove={moveReorder} onpointerup={endReorder} onpointercancel={cancelPointer} onlostpointercapture={cancelPointer}>
  {#if items.length === 0 && !ownTarget}<p class="list-empty">Add links or text to this List.</p>{/if}
  <div class="list-rows" bind:this={rowContainer}>
    {#each visibleRows as row (row.id)}
      <div animate:flip={{ duration: preferences.reduceAnimations ? 0 : 140 }}>
        {#if row.item}
          {@const item = row.item}
          {@const display = listItemDisplay(item, board.notes, zones.byId)}
          <div class="list-row" data-list-row={item.id} class:missing={display.missing} class:insert-before={dropIndex === items.indexOf(item)}>
            <button class="list-grip" type="button" data-list-reorder={item.id} aria-label={`Drag ${display.label}`}
              onpointerdown={(event) => beginReorder(item.id, event)} onkeydown={(event) => reorderByKeyboard(item.id, items.indexOf(item), event)}>&#8942;&#8942;</button>
            <div class="list-content">
              {#if item.targetId && !display.missing}
                <button class="list-link" type="button" data-list-target={item.targetId} onclick={() => openTarget(item.targetId!)}>{display.label}</button>
              {:else}<span class="list-label">{display.label}</span>{/if}
            </div>
            {#if note.listStats}<div class="list-statistics"><ListStatsExtension list={note} {item} /></div>{/if}
            {#if display.missing}<span class="list-missing">missing</span>{/if}
            <ListKindIcon kind={listItemKind(item, board.notes, zones.byId)} />
            <button class="list-remove" type="button" data-list-remove={item.id} aria-label={`Remove ${display.label}`} onclick={() => removeListRow(note.id, item.id)}>&times;</button>
          </div>
        {:else}<div class="list-drag-slot" data-list-drag-slot={ownTarget?.index} style:height={`${preview?.height ?? 26}px`} aria-hidden="true"></div>{/if}
      </div>
    {/each}
    {#if dropIndex === items.length}<div class="list-end-slot" aria-hidden="true"></div>{/if}
  </div>
  {#if adding}
    <div class="list-picker" data-list-picker use:dismissBoardPopup={{ close: closePicker }} use:listPickerInput={closePicker}>
      <input data-list-search aria-label="Search board objects or type text" placeholder="Search board objects or type text" bind:this={searchInput} bind:value={query} onkeydown={handleSearchKeydown} />
      <div class="list-picker-results">
        {#each choices as choice (choice.id)}<button type="button" data-list-target-option={choice.id} onclick={() => addTarget(choice.id)}>{choice.name}</button>
        {:else}{#if query.trim()}<span class="list-picker-empty">No matching board object.</span>{/if}{/each}
      </div>
      <div class="list-picker-actions">
        <button type="button" data-list-add-text disabled={!query.trim()} onclick={addText}>Add text row</button>
        <button type="button" onclick={closePicker}>Cancel</button>
      </div>
    </div>
  {:else}<button class="list-add" type="button" data-list-add onclick={openPicker}>+ Add</button>{/if}
</div>

<style>
  .list-body { display: grid; min-width: 0; gap: 6px; padding: 2px; font-size: 11px; }
  .list-body.drop-target { outline: 2px solid var(--accent); outline-offset: -2px; background: #f5cd4d12; }
  .list-empty { margin: 0; padding: 6px; color: var(--text-dim); }
  .list-rows { display: grid; gap: 2px; }
  .list-row { display: flex; min-width: 0; min-height: 26px; align-items: center; gap: 4px; border: 1px solid #41444a; border-radius: 3px; background: #24262b; }
  .list-content { min-width: 0; flex: 1; display: grid; gap: 2px; }
  .list-statistics { min-width: 0; max-width: 60%; }
  .list-drag-slot { box-sizing: border-box; border: 1px dashed var(--accent); border-radius: 3px; background: #f5cd4d12; }
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
