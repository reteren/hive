<script lang="ts">
  import { noteMenuItemsForContext } from "./noteMenu";
  import "../tasks/taskActions.svelte";
  import { onMount } from "svelte";
  import type { Action } from "svelte/action";
  import { board } from "../model/board.svelte";
  import { camera, viewport } from "../board/camera.svelte";
  import { PX_PER_UNIT, screenToWorld } from "../board/cameraMath";
  import { measuredHeights } from "./layout.svelte";
  import { clearTextFitWidthCache, measureAndCacheTextMinimumWidth } from "../editor/textFitWidth";
  import NoteNode from "./NoteNode.svelte";
  import { copyCursorCoordinates } from "./noteCommands";
  import { closeCreationMenu, creationMenu, markCreationMenuToolbarTrigger } from "./creation.svelte";
  import { closeLinkContextMenu, linkContext } from "../links-in-text/contextMenu.svelte";
  import { formatPointAddress } from "../links-in-text/format";
  import TasksPanel from "../tasks/TasksPanel.svelte";
  import { boardPopupStyle, dismissBoardPopup, fitBoardPopupAnchor } from "../ui/boardAnchor";
  import { imageFirstOrder } from "../images/imageLogic";
  import ImageOpacityPopover from "../images/ImageOpacityPopover.svelte";
  import { handleBoardImagePaste, registerImageDropHandler, registerImagePasteToBoard } from "../images/imageActions";
  import { handleBoardAudioPaste, registerAudioDropHandler, registerAudioPasteHandler } from "../audio/audioActions";
  import {
    closeGifContextMenu,
    gifPlayback,
    gifTargetFromElement,
    openGifContextMenu,
  } from "../attachments/gifPlayback.svelte";

  let activeNoteMenuItems = $derived.by(() => {
    const menu = linkContext.menu;
    if (menu?.kind !== "note") return [];
    return noteMenuItemsForContext(menu.noteId, gifPlayback.contextMenu?.target ?? null);
  });
  let contextMenuZoomAtOpen = $state(1);
  let orderedNoteIds = $derived(imageFirstOrder(board.order, board.notes));

  onMount(() => {
    const boardElement = document.querySelector<HTMLElement>(".board");
    if (!boardElement) return;
    const unregisterImageDrop = registerImageDropHandler();
    const unregisterAudioDrop = registerAudioDropHandler();
    const unregisterImagePaste = registerImagePasteToBoard();
    const unregisterAudioPaste = registerAudioPasteHandler();
    window.addEventListener("paste", handleBoardImagePaste, true);
    window.addEventListener("paste", handleBoardAudioPaste, true);

    function onContextMenu(event: MouseEvent): void {
      const target = event.target instanceof Element ? event.target : null;
      if (!target || !target.closest(".board")) return;

      // The board owns context menus for notes and blank space. Suppress the browser menu
      // before checking feature surfaces so no node body can leak Chrome's native menu.
      event.preventDefault();
      closeGifContextMenu();
      // Feature surfaces with their own right-click menu (e.g. a Tierlist row label) handle it themselves.
      if (target.closest("[data-own-context-menu]")) return;
      if (target.closest("[data-create-menu]")) {
        event.stopPropagation();
        return;
      }

      const noteRoot = target.closest<HTMLElement>("[data-note-id]");
      const noteId = noteRoot?.dataset.noteId;
      const rect = boardElement!.getBoundingClientRect();
      const local = { x: event.clientX - rect.left, y: event.clientY - rect.top };
      const point = screenToWorld(camera, viewport, local);
      const boardGifTarget = noteId && board.notes[noteId]?.type === "image" && board.notes[noteId]?.image?.mime === "image/gif"
        ? { kind: "board" as const, noteId }
        : null;
      const gifTarget = gifTargetFromElement(target) ?? boardGifTarget;
      if (gifTarget) {
        event.stopPropagation();
        closeLinkContextMenu();
        linkContext.commandNoteId = gifTarget.noteId;
        linkContext.commandPoint = null;
        openGifContextMenu(gifTarget);
        const menuItems = noteMenuItemsForContext(gifTarget.noteId, gifTarget);
        const menuHeight = Math.max(44, menuItems.length * 32 + menuItems.filter((item) => item.dividerBefore).length * 7 + 8);
        const anchor = fitBoardPopupAnchor(camera, viewport, point, { width: 220, height: menuHeight });
        contextMenuZoomAtOpen = camera.zoom;
        linkContext.menu = { kind: "note", noteId: gifTarget.noteId, x: anchor.x, y: anchor.y };
        return;
      }
      if (noteRoot && noteId) {
        event.preventDefault();
        event.stopPropagation();
        const menuItems = noteMenuItemsForContext(noteId);
        const menuHeight = Math.max(44, menuItems.length * 32 + menuItems.filter((item) => item.dividerBefore).length * 7 + 8);
        contextMenuZoomAtOpen = camera.zoom;
        const anchor = fitBoardPopupAnchor(camera, viewport, point, { width: 220, height: menuHeight });
        linkContext.menu = {
          kind: "note",
          noteId,
          x: anchor.x,
          y: anchor.y,
        };
        linkContext.commandNoteId = noteId;
        linkContext.commandPoint = point;
        return;
      }

      event.preventDefault();
      event.stopPropagation();
      contextMenuZoomAtOpen = camera.zoom;
      const anchor = fitBoardPopupAnchor(camera, viewport, point, { width: 224, height: 44 });
      linkContext.menu = {
        kind: "board",
        point,
        x: anchor.x,
        y: anchor.y,
      };
      linkContext.commandNoteId = null;
      linkContext.commandPoint = point;
    }

    function onWindowClick(event: MouseEvent): void {
      const target = event.target instanceof Element ? event.target : null;
      if (target?.closest("[data-link-context-menu]")) return;
      closeGifContextMenu();
      if (target?.closest('button.command-button[aria-label^="New note"]')) {
        markCreationMenuToolbarTrigger();
        linkContext.commandNoteId = null;
        linkContext.commandPoint = null;
        closeLinkContextMenu();
        return;
      }
      if (target?.closest("[data-create-menu]")) {
        linkContext.commandNoteId = null;
        linkContext.commandPoint = null;
        closeLinkContextMenu();
        return;
      }
      if (creationMenu.open && !creationMenu.pinned) closeCreationMenu();
      if (target?.closest(".command-result")) {
        closeLinkContextMenu();
        return;
      }
      const clickedNoteId = target?.closest<HTMLElement>("[data-note-id]")?.dataset.noteId;
      linkContext.commandNoteId = clickedNoteId ?? null;
      linkContext.commandPoint = null;
      closeLinkContextMenu();
    }

    boardElement.addEventListener("contextmenu", onContextMenu, true);
    window.addEventListener("click", onWindowClick, true);
    return () => {
      unregisterImageDrop();
      unregisterAudioDrop();
      unregisterImagePaste();
      unregisterAudioPaste();
      window.removeEventListener("paste", handleBoardImagePaste, true);
      window.removeEventListener("paste", handleBoardAudioPaste, true);
      boardElement.removeEventListener("contextmenu", onContextMenu, true);
      window.removeEventListener("click", onWindowClick, true);
    };
  });

  function coordinateLabel(point: { x: number; y: number }): string {
    return formatPointAddress(point).replace("hive://point/", "");
  }

  function closeAllContextMenus(): void {
    closeLinkContextMenu();
    closeGifContextMenu();
  }

  const observeAutoHeight: Action<HTMLElement, string> = (element, initialId) => {
    let measurementKey = initialId;
    let noteId = noteIdFromMeasurementKey(initialId);

    const updateMeasuredHeight = () => {
      const note = board.notes[noteId];
      if (!note) return;

      measureAndCacheTextMinimumWidth(noteId, note.text, element, note.type);
      if (note.height !== null) return;

      const height = element.offsetHeight / PX_PER_UNIT;
      if (Number.isFinite(height) && height > 0 && measuredHeights[noteId] !== height) {
        measuredHeights[noteId] = height;
      }
    };

    const observer = new ResizeObserver(updateMeasuredHeight);
    observer.observe(element);

    return {
      update(nextId) {
        if (nextId === measurementKey) return;
        const nextNoteId = noteIdFromMeasurementKey(nextId);
        if (nextNoteId !== noteId) {
          delete measuredHeights[noteId];
          clearTextFitWidthCache(noteId);
          noteId = nextNoteId;
          observer.disconnect();
          observer.observe(element);
        }
        measurementKey = nextId;
        updateMeasuredHeight();
      },
      destroy() {
        observer.disconnect();
        delete measuredHeights[noteId];
        clearTextFitWidthCache(noteId);
      },
    };
  };

  function noteIdFromMeasurementKey(key: string): string {
    const separator = key.indexOf("\u0000");
    return separator === -1 ? key : key.slice(0, separator);
  }

  // 2D transform without will-change: the layer is not promoted to a cached bitmap, so text and
  // borders are re-rasterised at the current zoom instead of being stretched (blurry notes).
  const worldTransform = $derived(
    `translate(${viewport.width / 2}px, ${viewport.height / 2}px) ` +
      `scale(${camera.zoom}) ` +
      `translate(${-camera.x * PX_PER_UNIT}px, ${-camera.y * PX_PER_UNIT}px)`,
  );
</script>

<div class="notes-layer">
  <div class="notes-world" style:transform={worldTransform}>
    {#each orderedNoteIds as noteId (noteId)}
      {@const note = board.notes[noteId]}
      {#if note && note.type !== "beacon"}
        <NoteNode {note} measureHeight={observeAutoHeight} />
      {/if}
    {/each}
  </div>

  <TasksPanel />
  <ImageOpacityPopover />

  {#if linkContext.menu}
    <div
      class="link-context-menu"
      data-selection-ignore
      data-link-context-menu
      role="menu"
      tabindex="-1"
      aria-label={linkContext.menu.kind === "board" ? "Board actions" : "Note actions"}
      style={boardPopupStyle(camera, viewport, { x: linkContext.menu.x, y: linkContext.menu.y }, contextMenuZoomAtOpen)}
      use:dismissBoardPopup={{ close: closeAllContextMenus }}
      oncontextmenu={(event) => event.preventDefault()}
    >
      {#if linkContext.menu.kind === "board"}
        {@const point = linkContext.menu.point}
        <button
          type="button"
          role="menuitem"
          onclick={(event) => {
            event.stopPropagation();
            void copyCursorCoordinates(point);
            closeLinkContextMenu();
          }}
        >Copy coordinates ({coordinateLabel(point)})</button>
      {:else}
        {@const noteId = linkContext.menu.noteId}
        {#each activeNoteMenuItems as item (item.id)}
          {@const shortcut = item.shortcut?.(noteId) ?? ""}
          {#if item.dividerBefore}
            <div class="menu-divider" role="separator"></div>
          {/if}
          <button
            type="button"
            role="menuitem"
            onclick={(event) => {
              event.stopPropagation();
              item.run(noteId);
              closeAllContextMenus();
            }}
          >
            <span class="menu-item-label">{item.label(noteId)}</span>
            {#if shortcut}<span class="menu-item-shortcut">{shortcut}</span>{/if}
          </button>
        {/each}
      {/if}
    </div>
  {/if}

  {#if linkContext.status}
    <div class="link-status" data-selection-ignore role="status" aria-live="polite">
      {linkContext.status}
    </div>
  {/if}
</div>

<style>
  .notes-layer {
    position: absolute;
    inset: 0;
    overflow: visible;
    pointer-events: none;
  }

  .notes-world {
    position: absolute;
    inset: 0;
    overflow: visible;
    transform-origin: 0 0;
    pointer-events: none;
  }

  .link-context-menu {
    display: flex;
    position: absolute;
    z-index: 30;
    width: max-content;
    max-width: calc(100% - 16px);
    min-width: 168px;
    flex-direction: column;
    gap: 2px;
    padding: 4px;
    border: 1px solid #4c4c4c;
    border-radius: 4px;
    background: #242424;
    box-shadow: 0 5px 16px rgb(0 0 0 / 45%);
    pointer-events: auto;
  }

  .link-context-menu button {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 16px;
    width: 100%;
    min-width: 0;
    min-height: 28px;
    padding: 6px 8px;
    border: 0;
    border-radius: 2px;
    background: transparent;
    color: var(--text);
    text-align: left;
    white-space: normal;
    cursor: pointer;
  }

  .link-context-menu .menu-item-shortcut {
    flex: 0 0 auto;
    color: #8a8a8a;
    font-size: 10px;
    font-variant-numeric: tabular-nums;
    white-space: nowrap;
  }

  .link-context-menu button:hover .menu-item-shortcut,
  .link-context-menu button:focus-visible .menu-item-shortcut { color: #c4c4c4; }

  .link-context-menu .menu-divider {
    height: 1px;
    margin: 2px 7px;
    background: #474747;
  }

  .link-context-menu button:hover,
  .link-context-menu button:focus-visible {
    background: #393939;
    color: #fff;
  }

  .link-status {
    position: absolute;
    z-index: 29;
    left: 10px;
    bottom: 10px;
    max-width: min(320px, calc(100% - 20px));
    padding: 6px 9px;
    border: 1px solid #494949;
    border-radius: 3px;
    background: #292929;
    color: var(--text);
    box-shadow: 0 3px 10px rgb(0 0 0 / 32%);
    pointer-events: none;
  }
</style>
