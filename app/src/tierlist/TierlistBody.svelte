<script lang="ts">
  import { onMount, tick } from "svelte";
  import type { Note } from "../model/note";
  import type { TierCard, TierRow } from "../model/nodeData";
  import { board } from "../model/board.svelte";
  import { camera, viewport } from "../board/camera.svelte";
  import { worldToScreen, type Point } from "../board/cameraMath";
  import { activeDropTarget, registerDropTarget, type DropTargetMatch } from "../selection/dropTargets";
  import {
    addNoteTierCard,
    addTextTierCard,
    addTierlistRow,
    deleteTierlistCard,
    editTextTierCard,
    moveTierlistCard,
    recolorTierlistRow,
    removeTierlistRow,
    renameTierlistRow,
    reorderTierlistRow,
    rowsForTierlist,
  } from "./actions.svelte";
  import { tierCardPreview } from "./logic";

  let { note }: { note: Note } = $props();
  let root: HTMLDivElement;
  let rows = $derived(rowsForTierlist(note.id));
  let contextRowId = $state<string | null>(null);
  let deletingRowId = $state<string | null>(null);
  let editingRowId = $state<string | null>(null);
  let rowDraft = $state("");
  let rowInput: HTMLInputElement | undefined = $state();
  let contextMenuElement: HTMLDivElement | undefined = $state();
  let dialogCancelButton: HTMLButtonElement | undefined = $state();
  let editingCardId = $state<string | null>(null);
  let editingCardRowId = $state<string | null>(null);
  let cardDraft = $state("");
  let cardInput: HTMLTextAreaElement | undefined = $state();
  let selectedCard = $state<{ rowId: string; cardId: string } | null>(null);
  let draggedCard = $state<{ rowId: string; cardId: string } | null>(null);

  const rowColors = ["#8e3d46", "#a36536", "#8a7628", "#3f754c", "#315f83", "#654985", "#545b68"];
  const ROW_MIME = "application/x-hive-tier-row";
  const CARD_MIME = "application/x-hive-tier-card";

  onMount(() => registerDropTarget({
    ownerId: note.id,
    accepts: (noteIds, worldPoint) => findDropTarget(noteIds, worldPoint),
    drop: (noteIds, match) => {
      const sourceNoteId = noteIds[0];
      const rowId = (match.payload as { rowId?: string } | undefined)?.rowId;
      return rowId && sourceNoteId ? addNoteTierCard(note.id, rowId, sourceNoteId) : null;
    },
  }));

  onMount(() => {
    const onDocumentPointerDown = (event: PointerEvent): void => {
      if (!(event.target instanceof Element)) return;
      if (!root?.contains(event.target) || !event.target.closest(".tier-context-menu")) contextRowId = null;
    };
    const onDocumentKeydown = (event: KeyboardEvent): void => {
      if (event.key !== "Escape" || event.defaultPrevented || !root?.contains(document.activeElement)) return;
      if (deletingRowId) {
        event.preventDefault();
        commitDeleteRow("cancel");
      } else if (contextRowId) {
        event.preventDefault();
        contextRowId = null;
      }
    };
    document.addEventListener("pointerdown", onDocumentPointerDown);
    document.addEventListener("keydown", onDocumentKeydown);
    return () => {
      document.removeEventListener("pointerdown", onDocumentPointerDown);
      document.removeEventListener("keydown", onDocumentKeydown);
    };
  });

  function findDropTarget(noteIds: readonly string[], worldPoint: Point): DropTargetMatch | null {
    if (noteIds.length !== 1 || !root || !board.notes[noteIds[0]] || noteIds[0] === note.id) return null;
    const boardElement = root.closest<HTMLElement>(".board");
    const boardRect = boardElement?.getBoundingClientRect();
    if (!boardRect) return null;
    const local = worldToScreen(camera, viewport, worldPoint);
    const clientX = boardRect.left + local.x;
    const clientY = boardRect.top + local.y;

    for (const area of root.querySelectorAll<HTMLElement>("[data-tier-row-cards]")) {
      const rect = area.getBoundingClientRect();
      if (clientX < rect.left || clientX > rect.right || clientY < rect.top || clientY > rect.bottom) continue;
      const rowId = area.dataset.tierRowCards;
      if (!rowId) continue;
      return { targetId: `${note.id}:${rowId}`, ownerId: note.id, payload: { rowId } };
    }
    return null;
  }

  function openRowMenu(event: MouseEvent, row: TierRow): void {
    event.preventDefault();
    event.stopPropagation();
    contextRowId = contextRowId === row.id ? null : row.id;
    if (contextRowId) void tick().then(() => contextMenuElement?.querySelector<HTMLButtonElement>(".tier-swatch")?.focus());
  }

  function beginRenameRow(row: TierRow, event: MouseEvent): void {
    event.preventDefault();
    event.stopPropagation();
    contextRowId = null;
    editingRowId = row.id;
    rowDraft = row.name;
    void tick().then(() => {
      rowInput?.focus();
      rowInput?.select();
    });
  }

  function finishRenameRow(rowId: string, commit: boolean): void {
    if (editingRowId !== rowId) return;
    if (commit) renameTierlistRow(note.id, rowId, rowDraft);
    editingRowId = null;
  }

  function requestDeleteRow(row: TierRow): void {
    contextRowId = null;
    if (row.cards.length === 0) {
      removeTierlistRow(note.id, row.id, "delete-cards");
    } else {
      deletingRowId = row.id;
      void tick().then(() => dialogCancelButton?.focus());
    }
  }

  function commitDeleteRow(choice: "move-below" | "delete-cards" | "cancel"): void {
    if (deletingRowId) removeTierlistRow(note.id, deletingRowId, choice);
    deletingRowId = null;
  }

  function addTextCard(rowId: string, event: MouseEvent): void {
    event.preventDefault();
    event.stopPropagation();
    if (event.target instanceof Element && event.target.closest("[data-tier-card-id]")) return;
    const cardId = addTextTierCard(note.id, rowId);
    selectedCard = { rowId, cardId };
    editingCardRowId = rowId;
    editingCardId = cardId;
    cardDraft = "";
    void tick().then(() => cardInput?.focus());
  }

  function beginEditCard(row: TierRow, card: TierCard, event: MouseEvent): void {
    event.stopPropagation();
    selectedCard = { rowId: row.id, cardId: card.id };
    if (card.kind !== "text") return;
    editingCardRowId = row.id;
    editingCardId = card.id;
    cardDraft = card.text;
    void tick().then(() => {
      cardInput?.focus();
      cardInput?.select();
    });
  }

  function finishEditCard(commit: boolean): void {
    const rowId = editingCardRowId;
    const cardId = editingCardId;
    if (commit && rowId && cardId) {
      const existing = rows.find((row) => row.id === rowId)?.cards.find((card) => card.id === cardId);
      if (existing?.kind === "text" && existing.text !== cardDraft) {
        editTextTierCard(note.id, rowId, cardId, cardDraft);
      }
    }
    editingCardId = null;
    editingCardRowId = null;
  }

  function handleCardEditorKeydown(event: KeyboardEvent): void {
    if (event.key === "Escape") {
      event.preventDefault();
      finishEditCard(false);
    } else if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) {
      event.preventDefault();
      cardInput?.blur();
    }
  }

  function handleCardKeydown(rowId: string, cardId: string, event: KeyboardEvent): void {
    if ((event.key !== "Delete" && event.key !== "Backspace") || !selectedCard) return;
    if (selectedCard.rowId !== rowId || selectedCard.cardId !== cardId) return;
    event.preventDefault();
    event.stopPropagation();
    deleteTierlistCard(note.id, rowId, cardId);
    selectedCard = null;
  }

  function dragTypes(event: DragEvent, mime: string): boolean {
    return Array.from(event.dataTransfer?.types ?? []).includes(mime);
  }

  function beginRowDrag(row: TierRow, event: DragEvent): void {
    if (!event.dataTransfer) return;
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData(ROW_MIME, JSON.stringify({ rowId: row.id }));
  }

  function allowRowDrop(event: DragEvent): void {
    if (!dragTypes(event, ROW_MIME)) return;
    event.preventDefault();
    if (event.dataTransfer) event.dataTransfer.dropEffect = "move";
  }

  function dropRow(targetRow: TierRow, targetIndex: number, event: DragEvent): void {
    if (!event.dataTransfer || !dragTypes(event, ROW_MIME)) return;
    event.preventDefault();
    event.stopPropagation();
    try {
      const payload = JSON.parse(event.dataTransfer.getData(ROW_MIME)) as { rowId?: string };
      if (payload.rowId) {
        const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
        const afterHalf = event.clientY >= rect.top + rect.height / 2;
        reorderTierlistRow(note.id, payload.rowId, targetIndex + (afterHalf ? 1 : 0));
      }
    } catch {
      // Ignore malformed browser drag payloads.
    }
  }

  function beginCardDrag(rowId: string, card: TierCard, event: DragEvent): void {
    if (editingCardId === card.id || !event.dataTransfer) return;
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData(CARD_MIME, JSON.stringify({ tierlistId: note.id, rowId, cardId: card.id }));
    draggedCard = { rowId, cardId: card.id };
  }

  function allowCardDrop(event: DragEvent): void {
    if (!dragTypes(event, CARD_MIME)) return;
    event.preventDefault();
    if (event.dataTransfer) event.dataTransfer.dropEffect = "move";
  }

  function dropCard(rowId: string, event: DragEvent): void {
    if (!event.dataTransfer || !dragTypes(event, CARD_MIME)) return;
    event.preventDefault();
    event.stopPropagation();
    try {
      const payload = JSON.parse(event.dataTransfer.getData(CARD_MIME)) as { rowId?: string; cardId?: string; tierlistId?: string };
      if (!payload.rowId || !payload.cardId) return;
      if (payload.tierlistId && payload.tierlistId !== note.id) return;
      const cardsTarget = event.target instanceof Element ? event.target.closest<HTMLElement>("[data-tier-card-id]") : null;
      const targetRow = rows.find((row) => row.id === rowId);
      if (!targetRow) return;
      let targetIndex = targetRow.cards.length;
      if (cardsTarget?.dataset.tierCardId) {
        const index = targetRow.cards.findIndex((card) => card.id === cardsTarget.dataset.tierCardId);
        if (index >= 0) {
          const rect = cardsTarget.getBoundingClientRect();
          targetIndex = index + (event.clientX >= rect.left + rect.width / 2 ? 1 : 0);
        }
      }
      moveTierlistCard(note.id, payload.rowId, payload.cardId, rowId, targetIndex);
      draggedCard = null;
    } catch {
      draggedCard = null;
    }
  }

  function cardPreview(card: TierCard) {
    return tierCardPreview(card, board.notes);
  }

  function rowIndexFor(rowId: string, currentRows: readonly TierRow[]): number {
    return currentRows.findIndex((row) => row.id === rowId);
  }
</script>

<div
  class="tierlist-body note-body"
  data-selection-ignore
  role="group"
  aria-label={`Tierlist ${note.name}`}
  bind:this={root}
>
  {#each rows as row, rowIndex (row.id)}
    <section class="tier-row" style:--tier-color={row.color}>
      <div class="tier-label-wrap">
        {#if editingRowId === row.id}
          <input
            class="tier-label-edit"
            bind:this={rowInput}
            bind:value={rowDraft}
            aria-label={`Rename tier ${row.name}`}
            onkeydown={(event) => {
              if (event.key === "Enter") { event.preventDefault(); finishRenameRow(row.id, true); }
              else if (event.key === "Escape") { event.preventDefault(); finishRenameRow(row.id, false); }
            }}
            onblur={() => finishRenameRow(row.id, true)}
          />
        {:else}
          <div
            class="tier-label"
            draggable="true"
            role="button"
            tabindex="0"
            aria-label={`${row.name} tier. Double-click to rename, right-click for options.`}
            ondblclick={(event) => beginRenameRow(row, event)}
            oncontextmenu={(event) => openRowMenu(event, row)}
            ondragstart={(event) => beginRowDrag(row, event)}
            ondragover={allowRowDrop}
            ondrop={(event) => dropRow(row, rowIndex, event)}
          >
            <span>{row.name}</span>
          </div>
        {/if}
        {#if contextRowId === row.id}
          <div class="tier-context-menu" data-selection-ignore role="menu" aria-label={`${row.name} tier options`} bind:this={contextMenuElement}>
            <span class="tier-menu-heading">Colour</span>
            <div class="tier-palette">
              {#each rowColors as color (color)}
                <button
                  class="tier-swatch"
                  class:current={color.toLowerCase() === row.color.toLowerCase()}
                  type="button"
                  role="menuitemradio"
                  aria-checked={color.toLowerCase() === row.color.toLowerCase()}
                  aria-label={`Set ${row.name} colour ${color}`}
                  style:--swatch={color}
                  onclick={() => { recolorTierlistRow(note.id, row.id, color); contextRowId = null; }}
                ></button>
              {/each}
            </div>
            <button class="tier-menu-delete" type="button" role="menuitem" onclick={() => requestDeleteRow(row)}>Delete row</button>
          </div>
        {/if}
      </div>

      <div
        class="tier-row-cards"
        data-tier-row-cards={row.id}
        class:drop-target={$activeDropTarget?.targetId === `${note.id}:${row.id}`}
        role="group"
        ondragover={allowCardDrop}
        ondrop={(event) => dropCard(row.id, event)}
        ondblclick={(event) => addTextCard(row.id, event)}
        aria-label={`${row.name} tier cards`}
      >
        {#each row.cards as card (card.id)}
          {@const preview = cardPreview(card)}
          <div
            class="tier-card-wrap"
            class:dragging={draggedCard?.cardId === card.id}
            data-tier-card-id={card.id}
            role="group"
            aria-label={`Tier card in ${row.name}`}
            draggable={editingCardId !== card.id}
            ondragstart={(event) => beginCardDrag(row.id, card, event)}
            ondragend={() => { draggedCard = null; }}
          >
            {#if editingCardId === card.id && card.kind === "text"}
              <textarea
                class="tier-card-editor"
                bind:this={cardInput}
                bind:value={cardDraft}
                aria-label="Edit tier card"
                onfocus={() => { selectedCard = { rowId: row.id, cardId: card.id }; }}
                onkeydown={handleCardEditorKeydown}
                onblur={() => finishEditCard(true)}
              ></textarea>
            {:else}
              <button
                class="tier-card"
                class:selected={selectedCard?.cardId === card.id}
                class:missing={preview.kind === "note" && preview.missing}
                type="button"
                aria-label={preview.kind === "text" ? `Text card: ${preview.text || "empty"}` : `Node preview: ${preview.name}`}
                aria-pressed={selectedCard?.cardId === card.id}
                onfocus={() => { selectedCard = { rowId: row.id, cardId: card.id }; }}
                onclick={() => { selectedCard = { rowId: row.id, cardId: card.id }; }}
                ondblclick={(event) => beginEditCard(row, card, event)}
                onkeydown={(event) => handleCardKeydown(row.id, card.id, event)}
              >
                {#if preview.kind === "text"}
                  <span>{preview.text || "Double-click to edit"}</span>
                {:else}
                  <strong>{preview.name}</strong>
                  {#if !preview.missing}
                    <span>{preview.lines.join("\n") || "No text"}</span>
                  {/if}
                {/if}
              </button>
            {/if}
            <button
              class="tier-card-delete"
              type="button"
              data-selection-ignore
              aria-label="Delete tier card"
              title="Delete card"
              onclick={(event) => {
                event.stopPropagation();
                deleteTierlistCard(note.id, row.id, card.id);
                selectedCard = null;
              }}
            >×</button>
          </div>
        {/each}
        {#if row.cards.length === 0}
          <span class="tier-empty-hint">Double-click to add a text card or drop a node here</span>
        {/if}
      </div>
    </section>
  {/each}

  <button class="tier-add-row" type="button" onclick={() => addTierlistRow(note.id)}>+ Add row</button>

  {#if deletingRowId}
    {@const deletingRow = rows.find((row) => row.id === deletingRowId)}
    {@const belowRow = rows[rowIndexFor(deletingRowId, rows) + 1]}
    <div class="tier-dialog-backdrop" data-selection-ignore>
      <div class="tier-delete-dialog" role="dialog" aria-modal="true" aria-label="Delete non-empty tier">
        <strong>Delete “{deletingRow?.name}”?</strong>
        <p>This row has {deletingRow?.cards.length ?? 0} cards.</p>
        {#if belowRow}
          <button type="button" onclick={() => commitDeleteRow("move-below")}>Move cards to {belowRow.name}</button>
        {/if}
        <button class="danger" type="button" onclick={() => commitDeleteRow("delete-cards")}>Delete row and cards</button>
        <button bind:this={dialogCancelButton} type="button" onclick={() => commitDeleteRow("cancel")}>Cancel</button>
      </div>
    </div>
  {/if}
</div>

<style>
  .tierlist-body {
    display: flex;
    min-width: 0;
    flex-direction: column;
    gap: 5px;
    padding: 2px 1px;
  }

  .tier-row {
    display: grid;
    min-height: 72px;
    grid-template-columns: 52px minmax(0, 1fr);
    overflow: visible;
    border: 1px solid #41444a;
    border-radius: 4px;
    background: #1a1b1e;
  }

  .tier-label-wrap {
    position: relative;
    display: flex;
    min-width: 0;
    align-items: stretch;
    border-radius: 3px 0 0 3px;
    background: var(--tier-color);
  }

  .tier-label {
    display: flex;
    width: 100%;
    align-items: center;
    justify-content: center;
    overflow: hidden;
    padding: 5px;
    color: #f6f4f1;
    font-size: 14px;
    font-weight: 750;
    text-overflow: ellipsis;
    cursor: grab;
    user-select: none;
  }

  .tier-label:active { cursor: grabbing; }
  .tier-label:focus-visible { outline: 2px solid var(--accent); outline-offset: -3px; }

  .tier-label-edit {
    width: 100%;
    min-width: 0;
    padding: 4px;
    border: 1px solid var(--accent);
    color: white;
    background: #24262b;
    font: inherit;
    text-align: center;
  }

  .tier-context-menu {
    position: absolute;
    z-index: 5;
    top: 4px;
    left: calc(100% + 4px);
    display: grid;
    min-width: 142px;
    gap: 5px;
    padding: 7px;
    border: 1px solid #4a4d52;
    border-radius: 5px;
    background: #222428;
    box-shadow: 0 6px 18px #0009;
  }

  .tier-menu-heading { color: #b7b9bf; font-size: 10px; }
  .tier-palette { display: flex; flex-wrap: wrap; gap: 4px; }
  .tier-swatch { width: 19px; height: 19px; padding: 0; border: 1px solid #ffffff50; border-radius: 50%; background: var(--swatch); cursor: pointer; }
  .tier-swatch.current { outline: 2px solid var(--accent); outline-offset: 1px; }
  .tier-menu-delete { padding: 5px 6px; border: 1px solid #51545a; border-radius: 3px; color: #f0dada; background: #39282b; text-align: left; cursor: pointer; }

  .tier-row-cards {
    display: flex;
    min-width: 0;
    min-height: 70px;
    align-content: flex-start;
    align-items: flex-start;
    flex-wrap: wrap;
    gap: 5px;
    padding: 5px;
    border-radius: 0 3px 3px 0;
    transition: background-color 90ms ease, box-shadow 90ms ease;
  }

  .tier-row-cards.drop-target {
    background: #f5cd4d17;
    box-shadow: inset 0 0 0 2px var(--accent);
  }

  .tier-empty-hint { align-self: center; padding: 7px; color: #747780; font-size: 10px; pointer-events: none; }

  .tier-card-wrap {
    position: relative;
    width: 92px;
    min-height: 56px;
    flex: 0 0 auto;
  }

  .tier-card-wrap:has(.tier-card-editor) { border: 1px solid var(--accent); border-radius: 4px; background: #292c31; }

  .tier-card {
    position: relative;
    display: flex;
    width: 100%;
    min-height: 56px;
    max-height: 80px;
    flex-direction: column;
    overflow: hidden;
    gap: 2px;
    padding: 7px 15px 6px 7px;
    border: 1px solid #4a4e55;
    border-radius: 4px;
    color: #dedfe2;
    background: #292c31;
    cursor: grab;
    text-align: left;
    user-select: none;
  }

  .tier-card:hover { border-color: #747981; }
  .tier-card.selected { border-color: var(--accent); box-shadow: 0 0 0 1px #f5cd4d50; }
  .tier-card:focus-visible { outline: 2px solid var(--accent); outline-offset: 1px; }
  .tier-card-wrap.dragging { opacity: 0.5; }
  .tier-card.missing { border-style: dashed; color: #aaa; background: #242529; }
  .tier-card strong { overflow: hidden; color: #f0e4c9; font-size: 10px; text-overflow: ellipsis; white-space: nowrap; }
  .tier-card.missing strong { display: -webkit-box; font-size: 9px; text-overflow: clip; white-space: normal; line-clamp: 2; -webkit-box-orient: vertical; -webkit-line-clamp: 2; }
  .tier-card span { display: -webkit-box; overflow: hidden; color: #bfc1c6; font-size: 10px; line-height: 1.25; white-space: pre-line; line-clamp: 3; -webkit-box-orient: vertical; -webkit-line-clamp: 3; }
  .tier-card-editor { box-sizing: border-box; width: 100%; min-height: 56px; max-height: 80px; resize: vertical; padding: 7px 15px 6px 7px; border: 0; outline: 0; overflow: auto; color: #dedfe2; background: transparent; font: inherit; font-size: 10px; user-select: text; }
  .tier-card-delete { position: absolute; z-index: 1; top: 2px; right: 2px; display: grid; width: 14px; height: 14px; place-items: center; padding: 0; border: 0; border-radius: 3px; color: #92959c; background: #292c31; font-size: 14px; line-height: 1; cursor: pointer; opacity: 0; }
  .tier-card-wrap:hover .tier-card-delete, .tier-card-wrap:focus-within .tier-card-delete { opacity: 1; }
  .tier-card-delete:hover { color: white; background: #663c40; }

  .tier-add-row { align-self: flex-start; padding: 5px 9px; border: 1px dashed #50535a; border-radius: 3px; color: #c0c1c5; background: #222428; font: inherit; font-size: 11px; cursor: pointer; }
  .tier-add-row:hover { border-color: var(--accent); color: var(--accent); }

  .tier-dialog-backdrop { position: absolute; z-index: 10; inset: 0; display: grid; place-items: center; padding: 10px; background: #08090bcc; }
  .tier-delete-dialog { display: flex; width: min(260px, 100%); flex-direction: column; gap: 7px; padding: 12px; border: 1px solid #53565d; border-radius: 5px; color: var(--text); background: #25272c; box-shadow: 0 8px 24px #000a; }
  .tier-delete-dialog strong { font-size: 13px; }
  .tier-delete-dialog p { margin: 0; color: #b4b6bb; font-size: 11px; }
  .tier-delete-dialog button { padding: 6px 8px; border: 1px solid #4c5058; border-radius: 3px; color: var(--text); background: #303238; font: inherit; font-size: 11px; text-align: left; cursor: pointer; }
  .tier-delete-dialog button:hover { border-color: var(--accent); }
  .tier-delete-dialog button.danger { color: #f0c6c6; background: #3a292c; }
</style>
