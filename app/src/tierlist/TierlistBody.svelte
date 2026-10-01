<script lang="ts">
  import { onMount, tick } from "svelte";
  import { flip } from "svelte/animate";
  import { get } from "svelte/store";
  import { preferences } from "../settings/preferences.svelte";
  import { tierDragRows, tierDropOriginalIndex } from "./dragLayout";
  import { beginContentDrag, clearContentDrag, contentDragPreview, previewContentDrop, registerContentDropTarget, resolveContentDropTarget } from "../list/itemDrag";
  import { createContentMoveCommand } from "../list/transfers.svelte";
  import type { Note } from "../model/note";
  import type { TierCard, TierRow } from "../model/nodeData";
  import { board, updateNote } from "../model/board.svelte";
  import { zones } from "../model/zones.svelte";
  import { execute } from "../history/history.svelte";
  import { camera, viewport } from "../board/camera.svelte";
  import { screenToWorld, worldToScreen, type Point } from "../board/cameraMath";
  import { activeDropTarget, registerDropTarget, type DropTargetMatch } from "../selection/dropTargets";
  import AttachmentImage from "../attachments/AttachmentImage.svelte";
  import GifView from "../attachments/GifView.svelte";
  import { selection } from "../selection/selection.svelte";
  import { registerImagePasteHandler } from "../attachments/pasteDispatch";
  import { addTierlistImagesFromPicker } from "./imagePicker";
  import {
    importImageFile,
    importImagePath,
    pickImageFiles,
    registerFileDropHandler,
    reportImportError,
    type ImportResult,
  } from "../attachments/service";
  import type { ImageRef } from "../attachments/types";
  import {
    addImageTierCards,
    addNoteTierCard,
    addTextTierCard,
    addTierlistRow,
    createTierlistTextCardNoteCommand,
    deleteTierlistCard,
    duplicateTierlistCard,
    editTextTierCard,
    moveTierlistCard,
    recolorTierlistRow,
    removeTierlistRow,
    renameTierlistRow,
    reorderTierlistRow,
    rowsForTierlist,
  } from "./actions.svelte";
  import {
    areTierHintsDismissed,
    DEFAULT_NEW_TIER_COLOR,
    markTierHintsDismissed,
    tierCardPreview,
    tierLabelTextColor,
    pointerDragThresholdPassed,
    tierCardDropTargetAt,
    tierCardInsertionIndicatorAt,
    tierRowInsertionIndexAt,
    type TierCardDropTarget,
    type TierRowDropGeometry,
    type TierRect,
  } from "./logic";

  type PointerDrag =
    | {
        kind: "card";
        pointerId: number;
        captureTarget: HTMLElement;
        start: Point;
        moved: boolean;
        sourceRowId: string;
        card: TierCard;
        visual: { clone: HTMLElement; width: number; height: number; zoomX: number; zoomY: number; offset: Point };
      }
    | {
        kind: "row";
        pointerId: number;
        captureTarget: HTMLElement;
        start: Point;
        moved: boolean;
        rowId: string;
        name: string;
        color: string;
      };

  type DragDisplay =
    | {
        kind: "card";
        sourceRowId: string;
        card: TierCard;
        targetNoteId: string | null;
        target: TierCardDropTarget | null;
      }
    | {
        kind: "row";
        rowId: string;
        name: string;
        color: string;
        targetIndex: number;
      };

  let { note }: { note: Note } = $props();
  let root: HTMLDivElement;
  let rows = $derived(rowsForTierlist(note.id));
  let displayRows = $derived(tierDragRows(rows, note.id, $contentDragPreview));
  let hintsDismissed = $derived(areTierHintsDismissed(rows));
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
  let dragDisplay = $state<DragDisplay | null>(null);
  let activePointerDrag: PointerDrag | null = null;
  let dragGhost: HTMLDivElement | null = null;
  let cardInsertionIndicator: HTMLSpanElement | null = null;
  let cardInsertionIndicatorRoot: HTMLElement | null = null;
  let cardDropTargetArea: HTMLElement | null = null;
  let hoveredRowId: string | null = null;

  const rowColors = ["#FF4B5C", "#FFB347", "#FFE66D", "#C3FF68", "#7DFFB3", "#5CD8FF", "#9F8BFF", DEFAULT_NEW_TIER_COLOR];

  onMount(() => registerDropTarget({
    ownerId: note.id,
    accepts: (noteIds, worldPoint) => findDropTarget(noteIds, worldPoint),
    drop: (noteIds, match) => {
      const sourceNoteId = noteIds[0];
      const rowId = (match.payload as { rowId?: string } | undefined)?.rowId;
      if (!rowId || !sourceNoteId) return null;
      dismissTierHints();
      return addNoteTierCard(note.id, rowId, sourceNoteId);
    },
  }));

  onMount(() => registerContentDropTarget((point, source) => {
    if (tierlistRootAt(point) !== root) return null;
    const target = tierCardDropTargetAt(point, measureTierRows());
    return target ? { kind: "tierlist", noteId: note.id, rowId: target.rowId, index: target.index } : null;
  }));

  onMount(() => {
    const unregisterFileDrop = registerFileDropHandler(30, handleTierlistFileDrop);
    const unregisterImagePaste = registerImagePasteHandler(30, (files) => {
      const activeElement = document.activeElement instanceof Element ? document.activeElement : null;
      const rowId = rowIdAt(activeElement) ?? hoveredRowId;
      if (!rowId) return false;
      void importImageFilesIntoRow(rowId, files);
      return true;
    });
    return () => {
      unregisterFileDrop();
      unregisterImagePaste();
    };
  });

  $effect(() => {
    const preview = $contentDragPreview;
    if (preview?.source.kind !== "list") return;
    const target = preview.target;
    if (target?.kind === "tierlist" && target.noteId === note.id && root) {
      const geometry = measureTierRows();
      updateCardInsertionIndicator(root, target, cardInsertionMarker(target, root, geometry));
    }
    return clearCardInsertionIndicator;
  });

  onMount(() => {
    const onDocumentPointerDown = (event: PointerEvent): void => {
      if (!(event.target instanceof Element)) return;
      if (!root?.contains(event.target) || !event.target.closest(".tier-context-menu")) contextRowId = null;
    };
    const onDocumentKeydown = (event: KeyboardEvent): void => {
      if (event.key === "Escape" && activePointerDrag) {
        event.preventDefault();
        event.stopPropagation();
        cancelPointerDrag();
        return;
      }
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
      cancelPointerDrag();
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

  async function addImageFromPicker(rowId: string): Promise<void> {
    contextRowId = null;
    await addTierlistImagesFromPicker(rowId, pickImageFiles, importImagePathsIntoRow);
  }

  async function importImagePathsIntoRow(rowId: string, paths: string[]): Promise<void> {
    const results = await Promise.all(paths.map((path) => importImagePath(path)));
    commitImageImports(rowId, results);
  }

  async function importImageFilesIntoRow(rowId: string, files: File[]): Promise<void> {
    const results = await Promise.all(files.map((file) => importImageFile(file)));
    commitImageImports(rowId, results);
  }

  function commitImageImports(rowId: string, results: readonly ImportResult[]): void {
    const images: ImageRef[] = [];
    const errors: string[] = [];
    for (const result of results) {
      if (result.ok) images.push(result.image);
      else errors.push(result.error);
    }
    if (errors.length > 0) reportImportError(errors.join("\n"));
    if (images.length === 0 || !rows.some((row) => row.id === rowId)) return;

    dismissTierHints();
    const cardIds = addImageTierCards(note.id, rowId, images);
    if (cardIds.length > 0) selectedCard = { rowId, cardId: cardIds[0] };
  }

  function handleTierlistFileDrop(
    paths: string[],
    target: Element | null,
    client: { x: number; y: number },
  ): boolean {
    if (paths.length === 0 || !root) return false;
    const hit = target ?? document.elementFromPoint(client.x, client.y);
    const rowId = rowIdAt(hit);
    if (!rowId) return false;
    void importImagePathsIntoRow(rowId, paths);
    return true;
  }

  function rowIdAt(element: Element | null): string | null {
    const rowElement = element?.closest<HTMLElement>("[data-tier-row-id]");
    const rowId = rowElement?.dataset.tierRowId;
    return rowElement && root?.contains(rowElement) && rowId && rows.some((row) => row.id === rowId) ? rowId : null;
  }

  function imageCardWidth(image: ImageRef): string {
    const contentHeight = 54;
    return `${Math.max(72, contentHeight * image.naturalWidth / image.naturalHeight + 2)}px`;
  }

  function cardImageWidth(card: TierCard): string | undefined {
    const preview = cardPreview(card);
    return preview.kind === "image" ? imageCardWidth(preview.image) : undefined;
  }

  function imagePreviewStyle(preview: Extract<ReturnType<typeof cardPreview>, { kind: "image" }>): string {
    const scaleX = preview.flipX ? -1 : 1;
    const scaleY = preview.flipY ? -1 : 1;
    return `width:100%;height:54px;object-fit:contain;transform:scale(${scaleX},${scaleY});transform-origin:center;`;
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

  function dismissTierHints(): void {
    if (areTierHintsDismissed(rows)) return;
    updateNote(note.id, { tiers: markTierHintsDismissed(rows) });
  }

  function beginCardPointerDrag(row: TierRow, card: TierCard, event: PointerEvent): void {
    if (event.button !== 0 || editingCardId === card.id) return;
    event.preventDefault();
    const element = (event.currentTarget as HTMLElement).closest<HTMLElement>("[data-tier-card-id]")!;
    const rect = element.getBoundingClientRect();
    beginPointerCapture({
      kind: "card",
      pointerId: event.pointerId,
      captureTarget: root,
      start: { x: event.clientX, y: event.clientY },
      moved: false,
      sourceRowId: row.id,
      card: { ...card },
      visual: { clone: element.cloneNode(true) as HTMLElement, width: element.offsetWidth, height: element.offsetHeight,
        zoomX: rect.width / Math.max(element.offsetWidth, 1), zoomY: rect.height / Math.max(element.offsetHeight, 1),
        offset: { x: event.clientX - rect.left, y: event.clientY - rect.top } },
    }, event);
  }

  function beginRowPointerDrag(row: TierRow, event: PointerEvent): void {
    if (event.button !== 0 || editingRowId === row.id) return;
    beginPointerCapture({
      kind: "row",
      pointerId: event.pointerId,
      captureTarget: event.currentTarget as HTMLElement,
      start: { x: event.clientX, y: event.clientY },
      moved: false,
      rowId: row.id,
      name: row.name,
      color: row.color,
    }, event);
  }

  function beginPointerCapture(drag: PointerDrag, event: PointerEvent): void {
    event.stopPropagation();
    contextRowId = null;
    dismissTierHints();
    activePointerDrag = drag;
    try {
      drag.captureTarget.setPointerCapture(drag.pointerId);
    } catch {
      activePointerDrag = null;
    }
  }

  function handlePointerDragMove(event: PointerEvent): void {
    hoveredRowId = rowIdAt(event.target instanceof Element ? event.target : null);
    const drag = activePointerDrag;
    if (!drag || drag.pointerId !== event.pointerId) return;
    event.stopPropagation();
    const point = { x: event.clientX, y: event.clientY };
    if (!drag.moved && !pointerDragThresholdPassed(drag.start, point)) return;
    if (!drag.moved && drag.kind === "card") {
      beginContentDrag({ kind: "tierlist", noteId: note.id, rowId: drag.sourceRowId, cardId: drag.card.id }, drag.visual.height,
        { kind: "tierlist", noteId: note.id, rowId: drag.sourceRowId, index: rows.find((row) => row.id === drag.sourceRowId)?.cards.findIndex((card) => card.id === drag.card.id) ?? 0 }, drag.visual.width);
    }
    drag.moved = true;
    event.preventDefault();
    if (drag.kind === "card") previewContentDrop(point);
    updateDragGhost(drag, point);

    if (drag.kind === "card") {
      const targetRoot = tierlistRootAt(point);
      const targetNoteId = targetRoot?.dataset.tierlistId ?? null;
      const geometry = measureTierRows(targetRoot);
      const target = targetRoot ? tierCardDropTargetAt(point, geometry) : null;
      updateCardInsertionIndicator(targetRoot, target, targetRoot && target ? cardInsertionMarker(target, targetRoot, geometry) : null);
      dragDisplay = {
        kind: "card",
        sourceRowId: drag.sourceRowId,
        card: drag.card,
        targetNoteId,
        target,
      };
    } else {
      const geometry = measureTierRows();
      dragDisplay = {
        kind: "row",
        rowId: drag.rowId,
        name: drag.name,
        color: drag.color,
        targetIndex: tierRowInsertionIndexAt(point.y, geometry),
      };
    }
  }

  function handlePointerDragUp(event: PointerEvent): void {
    const drag = activePointerDrag;
    if (!drag || drag.pointerId !== event.pointerId) return;
    event.stopPropagation();
    const point = { x: event.clientX, y: event.clientY };
    const contentTarget = drag.kind === "card"
      ? resolveContentDropTarget(point, { kind: "tierlist", noteId: note.id, rowId: drag.sourceRowId, cardId: drag.card.id }) : null;
    activePointerDrag = null;
    dragDisplay = null;
    removeDragGhost();
    clearCardInsertionIndicator();
    if (drag.kind === "card") clearContentDrag();
    releasePointer(drag);
    if (!drag.moved && !pointerDragThresholdPassed(drag.start, point)) return;

    if (drag.kind === "card" && contentTarget?.kind === "list") {
      const command = createContentMoveCommand({ kind: "tierlist", noteId: note.id, rowId: drag.sourceRowId, cardId: drag.card.id }, contentTarget);
      if (command) execute(command);
      return;
    }
    if (drag.kind === "card") {
      if (contentTarget?.kind === "tierlist") {
        if (contentTarget.noteId === note.id) {
          const source = { kind: "tierlist" as const, noteId: note.id, rowId: drag.sourceRowId, cardId: drag.card.id };
          moveTierlistCard(note.id, drag.sourceRowId, drag.card.id, contentTarget.rowId, tierDropOriginalIndex(rows, source, contentTarget));
        } else {
          duplicateTierlistCard(note.id, drag.sourceRowId, drag.card.id, contentTarget.noteId, contentTarget.rowId, contentTarget.index);
        }
        return;
      }
      if (drag.card.kind !== "text") return;
      const worldPoint = boardDropWorldPoint(point);
      if (!worldPoint) return;
      const command = createTierlistTextCardNoteCommand(note.id, drag.sourceRowId, drag.card.id, worldPoint);
      if (command) execute(command);
      return;
    }

    const geometry = measureTierRows();
    const rootRect = root?.getBoundingClientRect();
    if (!rootRect || !pointInsideRect(point, rootRect)) return;
    const targetIndex = tierRowInsertionIndexAt(point.y, geometry);
    reorderTierlistRow(note.id, drag.rowId, targetIndex);
  }

  function handlePointerDragCancel(event: PointerEvent): void {
    if (!activePointerDrag || activePointerDrag.pointerId !== event.pointerId) return;
    event.stopPropagation();
    cancelPointerDrag();
  }

  function handleLostPointerCapture(event: PointerEvent): void {
    if (!activePointerDrag || activePointerDrag.pointerId !== event.pointerId) return;
    cancelPointerDrag();
  }

  function cancelPointerDrag(): void {
    const drag = activePointerDrag;
    activePointerDrag = null;
    dragDisplay = null;
    removeDragGhost();
    clearCardInsertionIndicator();
    if (drag?.kind === "card") clearContentDrag();
    if (drag) releasePointer(drag);
  }

  function updateDragGhost(drag: PointerDrag, point: Point): void {
    if (drag.kind === "card") {
      if (!dragGhost) {
        dragGhost = document.createElement("div");
        dragGhost.className = "tier-drag-ghost";
        dragGhost.dataset.tierDragGhost = "";
        dragGhost.setAttribute("aria-hidden", "true");
        dragGhost.inert = true;
        const clone = drag.visual.clone;
        clone.removeAttribute("data-tier-card-id");
        clone.querySelector(".tier-card-delete")?.remove();
        dragGhost.append(clone);
        Object.assign(dragGhost.style, { width: `${drag.visual.width}px`, height: `${drag.visual.height}px`, opacity: "0.5",
          transform: `scale(${drag.visual.zoomX}, ${drag.visual.zoomY})` });
        document.body.append(dragGhost);
      }
      dragGhost.style.left = `${point.x - drag.visual.offset.x}px`;
      dragGhost.style.top = `${point.y - drag.visual.offset.y}px`;
      return;
    }
    if (!dragGhost) {
      dragGhost = document.createElement("div");
      dragGhost.className = "tier-drag-ghost";
      dragGhost.dataset.tierDragGhost = "";
      dragGhost.setAttribute("aria-hidden", "true");
      document.body.append(dragGhost);
    }
    dragGhost.replaceChildren();
    dragGhost.style.left = `${point.x + 12}px`;
    dragGhost.style.top = `${point.y + 12}px`;
    const rootRect = root.getBoundingClientRect();
    const zoomX = rootRect.width / Math.max(root.offsetWidth, 1);
    const zoomY = rootRect.height / Math.max(root.offsetHeight, 1);
    const sourceRect = drag.captureTarget.getBoundingClientRect();
    dragGhost.style.width = `${sourceRect.width / zoomX}px`;
    dragGhost.style.height = `${sourceRect.height / zoomY}px`;
    dragGhost.style.transform = `scale(${zoomX}, ${zoomY})`;
    const content = document.createElement("span");
    content.className = "tier-drag-ghost-label";
    content.style.setProperty("--tier-color", drag.color);
    content.textContent = drag.name;
    dragGhost.append(content);
  }

  function removeDragGhost(): void {
    dragGhost?.remove();
    dragGhost = null;
  }

  function releasePointer(drag: PointerDrag): void {
    try {
      if (drag.captureTarget.hasPointerCapture(drag.pointerId)) {
        drag.captureTarget.releasePointerCapture(drag.pointerId);
      }
    } catch {
      // Pointer capture may already be released when the component is removed.
    }
  }

  function measureTierRows(container: HTMLElement | null = root ?? null): TierRowDropGeometry[] {
    if (!container) return [];
    const noteId = container.dataset.tierlistId;
    const preview = get(contentDragPreview);
    return Array.from(container.querySelectorAll<HTMLElement>("[data-tier-row-id]")).flatMap((rowElement) => {
      const rowId = rowElement.dataset.tierRowId;
      const area = rowElement.querySelector<HTMLElement>("[data-tier-row-cards]");
      if (!rowId || !area) return [];
      const areaRect = area.getBoundingClientRect();
      const zoomX = areaRect.width / Math.max(area.offsetWidth, 1);
      const zoomY = areaRect.height / Math.max(area.offsetHeight, 1);
      // offset geometry ignores FLIP transforms, so animation cannot move the drop target.
      const frame = (element: HTMLElement): TierRect => ({ left: areaRect.left + element.offsetLeft * zoomX,
        top: areaRect.top + element.offsetTop * zoomY, right: areaRect.left + (element.offsetLeft + element.offsetWidth) * zoomX,
        bottom: areaRect.top + (element.offsetTop + element.offsetHeight) * zoomY });
      const source = preview?.source;
      let originalSlot: TierRowDropGeometry["slot"];
      const cards = Array.from(area.querySelectorAll<HTMLElement>("[data-tier-card-id]")).flatMap((element, index) => {
        const cardId = element.dataset.tierCardId;
        if (source?.kind === "tierlist" && source.noteId === noteId && source.rowId === rowId && source.cardId === cardId) {
          originalSlot = { index, rect: frame(element) };
          return [];
        }
        return cardId ? [{ cardId, rect: frame(element) }] : [];
      });
      const gap = area.querySelector<HTMLElement>("[data-tier-card-slot]");
      const target = preview?.target;
      const slot = gap && target?.kind === "tierlist" && target.noteId === noteId && target.rowId === rowId
        ? { index: target.index, rect: frame(gap) } : originalSlot;
      return [{ rowId, rect: toTierRect(rowElement.getBoundingClientRect()), cards, ...(slot ? { slot } : {}) }];
    });
  }

  function toTierRect(rect: DOMRect): TierRect {
    return { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom };
  }

  function pointInsideRect(point: Point, rect: TierRect | DOMRect): boolean {
    return point.x >= rect.left && point.x <= rect.right && point.y >= rect.top && point.y <= rect.bottom;
  }

  function tierlistRootAt(point: Point): HTMLElement | null {
    const boardElement = root?.closest<HTMLElement>(".board");
    const hit = document.elementFromPoint(point.x, point.y);
    const candidate = hit?.closest<HTMLElement>("[data-tierlist-id]") ?? null;
    return candidate && boardElement?.contains(candidate) ? candidate : null;
  }

  function boardDropWorldPoint(point: Point): Point | null {
    if (!root || pointInsideRect(point, root.getBoundingClientRect())) return null;
    const boardElement = root.closest<HTMLElement>(".board");
    const boardRect = boardElement?.getBoundingClientRect();
    if (!boardRect || !pointInsideRect(point, boardRect)) return null;
    const target = document.elementFromPoint(point.x, point.y);
    if (target?.closest("[data-tierlist-id], [data-list-node], [data-create-menu]")) return null;
    return screenToWorld(camera, viewport, { x: point.x - boardRect.left, y: point.y - boardRect.top });
  }

  function rowInsertionTop(targetIndex: number): string {
    const geometry = measureTierRows();
    if (!root || geometry.length === 0) return "0px";
    const rootRect = root.getBoundingClientRect();
    const boundaryY = targetIndex >= geometry.length
      ? geometry[geometry.length - 1].rect.bottom
      : geometry[Math.max(0, targetIndex)].rect.top;
    const scaleY = rootRect.height / Math.max(root.offsetHeight, 1);
    return `${(boundaryY - rootRect.top) / scaleY}px`;
  }

  function cardInsertionMarker(
    target: TierCardDropTarget,
    targetRoot: HTMLElement,
    geometry: readonly TierRowDropGeometry[],
  ): { left: number; top: number; width: number; height: number } | null {
    const rowArea = Array.from(targetRoot.querySelectorAll<HTMLElement>("[data-tier-row-cards]"))
      .find((element) => element.dataset.tierRowCards === target.rowId);
    const rootRect = targetRoot.getBoundingClientRect();
    const areaRect = rowArea?.getBoundingClientRect();
    if (!rowArea || !areaRect) return null;
    const zoomX = rootRect.width / Math.max(targetRoot.offsetWidth, 1);
    const zoomY = rootRect.height / Math.max(targetRoot.offsetHeight, 1);
    return tierCardInsertionIndicatorAt(
      target,
      geometry,
      toTierRect(areaRect),
      toTierRect(rootRect),
      zoomX,
      zoomY,
    );
  }

  function updateCardInsertionIndicator(
    targetRoot: HTMLElement | null,
    target: TierCardDropTarget | null,
    marker: { left: number; top: number; width: number; height: number } | null,
  ): void {
    const targetArea = targetRoot && target
      ? Array.from(targetRoot.querySelectorAll<HTMLElement>("[data-tier-row-cards]"))
        .find((element) => element.dataset.tierRowCards === target.rowId) ?? null
      : null;
    if (!targetRoot || !targetArea || !marker) {
      clearCardInsertionIndicator();
      return;
    }

    if (!cardInsertionIndicator) {
      cardInsertionIndicator = document.createElement("span");
      cardInsertionIndicator.className = "tier-card-insertion-indicator";
      cardInsertionIndicator.dataset.tierInsertionIndicator = "";
      cardInsertionIndicator.setAttribute("aria-hidden", "true");
    }
    if (cardInsertionIndicatorRoot !== targetRoot) {
      cardInsertionIndicatorRoot = targetRoot;
      targetRoot.append(cardInsertionIndicator);
    }
    if (cardDropTargetArea !== targetArea) {
      cardDropTargetArea?.classList.remove("card-drop-target");
      cardDropTargetArea = targetArea;
      cardDropTargetArea.classList.add("card-drop-target");
    }
    cardInsertionIndicator.style.left = `${marker.left}px`;
    cardInsertionIndicator.style.top = `${marker.top}px`;
    cardInsertionIndicator.style.width = `${marker.width}px`;
    cardInsertionIndicator.style.height = `${marker.height}px`;
  }

  function clearCardInsertionIndicator(): void {
    cardInsertionIndicator?.remove();
    cardInsertionIndicator = null;
    cardInsertionIndicatorRoot = null;
    cardDropTargetArea?.classList.remove("card-drop-target");
    cardDropTargetArea = null;
  }


  function cardPreview(card: TierCard) {
    return tierCardPreview(card, board.notes, zones.byId);
  }

  function rowIndexFor(rowId: string, currentRows: readonly TierRow[]): number {
    return currentRows.findIndex((row) => row.id === rowId);
  }
</script>

<div
  class="tierlist-body note-body"
  data-selection-ignore
  data-tierlist-id={note.id}
  role="group"
  aria-label={`Tierlist ${note.name}`}
  bind:this={root}
  onpointermove={handlePointerDragMove} onpointerup={handlePointerDragUp}
  onpointerleave={() => { hoveredRowId = null; }}
  onpointercancel={handlePointerDragCancel} onlostpointercapture={handleLostPointerCapture}
>
  {#each displayRows as row (row.id)}
    <section
      class="tier-row"
      data-tier-row-id={row.id}
      style:--tier-color={row.color}
      style:--tier-label-text={tierLabelTextColor(row.color)}
      role="group"
      aria-label={`${row.name} tier row`}
      onpointerdown={dismissTierHints}
    >
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
            class:pointer-drag-source={dragDisplay?.kind === "row" && dragDisplay.rowId === row.id}
            data-tier-row-label={row.id}
            data-own-context-menu
            role="button"
            tabindex="0"
            aria-label={`${row.name} tier. Double-click to rename, right-click for options.`}
            ondblclick={(event) => beginRenameRow(row, event)}
            oncontextmenu={(event) => openRowMenu(event, row)}
            onpointerdown={(event) => beginRowPointerDrag(row, event)}
            onpointermove={handlePointerDragMove}
            onpointerup={handlePointerDragUp}
            onpointercancel={handlePointerDragCancel}
            onlostpointercapture={handleLostPointerCapture}
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
            <button class="tier-menu-add-image" data-tier-add-image type="button" role="menuitem" onclick={() => { void addImageFromPicker(row.id); }}>
              Add image…
            </button>
            <button class="tier-menu-delete" type="button" role="menuitem" onclick={() => requestDeleteRow(row)}>Delete row</button>
          </div>
        {/if}
      </div>

      <div
        class="tier-row-cards"
        data-tier-row-cards={row.id}
        class:drop-target={$activeDropTarget?.targetId === `${note.id}:${row.id}` || ($contentDragPreview?.target?.kind === "tierlist" && $contentDragPreview.target.noteId === note.id && $contentDragPreview.target.rowId === row.id)}
        class:card-drop-target={dragDisplay?.kind === "card" && dragDisplay.targetNoteId === note.id && dragDisplay.target?.rowId === row.id}
        role="group"
        ondblclick={(event) => addTextCard(row.id, event)}
        aria-label={`${row.name} tier cards`}
      >
        {#each row.displayCards as entry (entry.id)}
          <div class="tier-card-wrap" animate:flip={{ duration: preferences.reduceAnimations ? 0 : 140 }}
            data-tier-card-id={entry.card?.id} data-tier-card-slot={entry.card ? undefined : ""}
            style:width={entry.card ? cardImageWidth(entry.card) : `${$contentDragPreview?.width ?? 92}px`}
            style:min-height={entry.card ? undefined : `${Math.max(56, $contentDragPreview?.height ?? 56)}px`}>
          {#if entry.card}
          {@const card = entry.card}
          {@const preview = cardPreview(card)}
          <div
            class="tier-card-content"
            data-tier-card-kind={card.kind}
            role="group"
            aria-label={`Tier card in ${row.name}`}
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
                class:image-card={preview.kind === "image"}
                class:selected={selectedCard?.cardId === card.id}
                class:missing={preview.kind === "note" && preview.missing}
                type="button"
                aria-label={preview.kind === "text" ? `Text card: ${preview.text || "empty"}` : preview.kind === "image" ? `Image card: ${preview.name}` : `Node preview: ${preview.name}`}
                aria-pressed={selectedCard?.cardId === card.id}
                onfocus={() => { selectedCard = { rowId: row.id, cardId: card.id }; }}
                onclick={() => { selectedCard = { rowId: row.id, cardId: card.id }; }}
                onpointerdown={(event) => beginCardPointerDrag(row, card, event)}
                ondblclick={(event) => beginEditCard(row, card, event)}
                onkeydown={(event) => handleCardKeydown(row.id, card.id, event)}
              >
                {#if preview.kind === "text"}
                  <span>{preview.text || "Double-click to edit"}</span>
                {:else if preview.kind === "image" && preview.image.mime === "image/gif"}
                  <GifView
                    image={preview.image}
                    target={{ kind: "tierlist", noteId: note.id, rowId: row.id, cardId: card.id }}
                    hostSelected={selection.ids.includes(note.id)}
                    hoverWhenSelected={true}
                    alt={preview.name}
                    class="tier-card-image"
                    style={imagePreviewStyle(preview)}
                  />
                {:else if preview.kind === "image"}
                  <AttachmentImage image={preview.image} alt={preview.name} class="tier-card-image" style={imagePreviewStyle(preview)} />
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
            >
              <svg aria-hidden="true" viewBox="0 0 12 12" width="10" height="10" focusable="false">
                <path d="M3 3l6 6M9 3 3 9" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" />
              </svg>
            </button>
          </div>
          {:else}<span class="tier-card-slot" aria-hidden="true"></span>{/if}
          </div>
        {/each}
        {#if row.displayCards.length === 0 && !hintsDismissed}
          <span class="tier-empty-hint" data-tier-hint>Double-click to add a text card or drop a node here</span>
        {/if}
      </div>
    </section>
  {/each}

  {#if dragDisplay?.kind === "row"}
    <span
      class="tier-row-insertion-indicator"
      data-tier-row-insertion-indicator
      style:top={rowInsertionTop(dragDisplay.targetIndex)}
      aria-hidden="true"
    ></span>
  {/if}

  <button class="tier-add-row" type="button" aria-label="Add row" title="Add row" onclick={() => { dismissTierHints(); addTierlistRow(note.id); }}>+</button>

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
    position: relative;
    display: flex;
    min-width: 0;
    flex-direction: column;
    gap: 0;
    padding: 2px 1px;
  }

  .tier-row {
    display: grid;
    min-height: 72px;
    grid-template-columns: 52px minmax(0, 1fr);
    overflow: visible;
    border-bottom: 1px solid #41444a;
    background: #1a1b1e;
  }

  .tier-row:first-of-type { border-top: 1px solid #41444a; }

  .tier-label-wrap {
    position: relative;
    display: flex;
    min-width: 0;
    align-items: stretch;
    border-radius: 0;
    background: var(--tier-color);
  }

  .tier-label {
    display: flex;
    width: 100%;
    align-items: center;
    justify-content: center;
    overflow: hidden;
    padding: 5px;
    color: var(--tier-label-text);
    font-size: 14px;
    font-weight: 750;
    text-overflow: ellipsis;
    cursor: grab;
    user-select: none;
  }

  .tier-label:active { cursor: grabbing; }
  .tier-label.pointer-drag-source { opacity: 0.35; }
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
  .tier-menu-add-image { padding: 5px 6px; border: 1px solid #51545a; border-radius: 3px; color: #e2e2e4; background: #2b2d32; text-align: left; cursor: pointer; }
  .tier-menu-add-image:hover, .tier-menu-add-image:focus-visible { border-color: var(--accent); color: #f2d277; }

  .tier-row-cards {
    position: relative;
    display: flex;
    min-width: 0;
    min-height: 70px;
    align-content: flex-start;
    align-items: flex-start;
    flex-wrap: wrap;
    gap: 5px;
    padding: 5px;
    border-radius: 0;
    transition: background-color 90ms ease, box-shadow 90ms ease;
  }

  .tier-row-cards.drop-target {
    background: #f5cd4d17;
    box-shadow: inset 0 0 0 2px var(--accent);
  }

  .tier-row-cards.card-drop-target { background: #f5cd4d0c; }

  :global(.tier-card-insertion-indicator) {
    position: absolute;
    z-index: 12;
    width: 3px;
    border-radius: 2px;
    background: var(--accent);
    box-shadow: 0 0 7px #f5cd4d90;
    pointer-events: none;
  }

  .tier-row-insertion-indicator {
    position: absolute;
    z-index: 12;
    right: 0;
    left: 0;
    height: 2px;
    background: var(--accent);
    box-shadow: 0 0 7px #f5cd4d90;
    pointer-events: none;
  }

  .tier-empty-hint { align-self: center; padding: 7px; color: #747780; font-size: 10px; pointer-events: none; }

  .tier-card-wrap {
    position: relative;
    width: 92px;
    min-height: 56px;
    flex: 0 0 auto;
  }

  .tier-card-content { position: relative; width: 100%; }
  .tier-card-slot { display: block; box-sizing: border-box; width: 100%; height: 100%; min-height: inherit; border: 1px dashed var(--accent); border-radius: 4px; background: #f5cd4d12; }
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
  .tier-card.image-card { box-sizing: border-box; height: 56px; min-height: 56px; max-height: 56px; padding: 0; }
  :global(.tier-card-image) { max-width: none; border-radius: 3px; }
  .tier-card.missing { border-style: dashed; color: #aaa; background: #242529; }
  .tier-card strong { overflow: hidden; color: #f0e4c9; font-size: 10px; text-overflow: ellipsis; white-space: nowrap; }
  .tier-card.missing strong { display: -webkit-box; font-size: 9px; text-overflow: clip; white-space: normal; line-clamp: 2; -webkit-box-orient: vertical; -webkit-line-clamp: 2; }
  .tier-card span { display: -webkit-box; overflow: hidden; color: #bfc1c6; font-size: 10px; line-height: 1.25; white-space: pre-line; line-clamp: 3; -webkit-box-orient: vertical; -webkit-line-clamp: 3; }
  .tier-card-editor { box-sizing: border-box; width: 100%; min-height: 56px; max-height: 80px; resize: vertical; padding: 7px 15px 6px 7px; border: 0; outline: 0; overflow: auto; color: #dedfe2; background: transparent; font: inherit; font-size: 10px; user-select: text; }
  .tier-card-delete { position: absolute; z-index: 1; top: 2px; right: 2px; display: grid; width: 14px; height: 14px; place-items: center; padding: 0; border: 0; border-radius: 3px; color: #92959c; background: #292c31; font-size: 14px; line-height: 1; cursor: pointer; opacity: 0; }
  .tier-card-wrap:hover .tier-card-delete, .tier-card-wrap:focus-within .tier-card-delete { opacity: 1; }
  .tier-card-delete:hover { color: white; background: #663c40; }

  :global(.tier-drag-ghost) {
    position: fixed;
    z-index: 2147483000;
    display: block;
    pointer-events: none;
    opacity: 0.95;
    transform-origin: top left;
  }

  :global(.tier-drag-ghost-card),
  :global(.tier-drag-ghost-label) {
    box-sizing: border-box;
    display: block;
    width: 100%;
    height: 100%;
    overflow: hidden;
    padding: 7px 9px;
    border: 1px solid var(--accent);
    border-radius: 4px;
    color: #f0f0f2;
    background: #292c31;
    box-shadow: 0 4px 14px #0009;
    font-size: 11px;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  :global(.tier-drag-ghost-label) { color: #202126; background: var(--tier-color); font-weight: 750; }

  .tier-add-row {
    box-sizing: border-box;
    display: grid;
    width: 100%;
    height: 20px;
    flex: 0 0 20px;
    place-items: center;
    padding: 0;
    border: 1px solid #41444a;
    border-top: 0;
    border-radius: 0;
    color: #c0c1c5;
    background: #222428;
    font: inherit;
    font-size: 16px;
    line-height: 1;
    cursor: pointer;
  }
  .tier-add-row:hover { border-color: var(--accent); color: var(--accent); }

  .tier-dialog-backdrop { position: absolute; z-index: 10; inset: 0; display: grid; place-items: center; padding: 10px; background: #08090bcc; }
  .tier-delete-dialog { display: flex; width: min(260px, 100%); flex-direction: column; gap: 7px; padding: 12px; border: 1px solid #53565d; border-radius: 5px; color: var(--text); background: #25272c; box-shadow: 0 8px 24px #000a; }
  .tier-delete-dialog strong { font-size: 13px; }
  .tier-delete-dialog p { margin: 0; color: #b4b6bb; font-size: 11px; }
  .tier-delete-dialog button { padding: 6px 8px; border: 1px solid #4c5058; border-radius: 3px; color: var(--text); background: #303238; font: inherit; font-size: 11px; text-align: left; cursor: pointer; }
  .tier-delete-dialog button:hover { border-color: var(--accent); }
  .tier-delete-dialog button.danger { color: #f0c6c6; background: #3a292c; }
</style>
