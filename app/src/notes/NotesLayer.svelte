<script lang="ts">
  import { onMount } from "svelte";
  import type { Action } from "svelte/action";
  import { board } from "../model/board.svelte";
  import { camera, viewport } from "../board/camera.svelte";
  import { PX_PER_UNIT, screenToWorld } from "../board/cameraMath";
  import { measuredHeights } from "./layout.svelte";
  import NoteNode from "./NoteNode.svelte";
  import { copyCursorCoordinates, copyNoteLink } from "./noteCommands";
  import { closeCreationMenu, creationMenu, markCreationMenuToolbarTrigger } from "./creation.svelte";
  import { closeLinkContextMenu, linkContext } from "../links-in-text/contextMenu.svelte";
  import { formatPointAddress } from "../links-in-text/format";

  onMount(() => {
    const boardElement = document.querySelector<HTMLElement>(".board");
    if (!boardElement) return;

    function onContextMenu(event: MouseEvent): void {
      const target = event.target instanceof Element ? event.target : null;
      if (!target || !target.closest(".board") || target.closest("[data-selection-ignore], [data-create-menu]")) return;

      const header = target.closest<HTMLElement>("[data-note-header]");
      const noteId = header?.closest<HTMLElement>("[data-note-id]")?.dataset.noteId;
      const rect = boardElement!.getBoundingClientRect();
      const local = { x: event.clientX - rect.left, y: event.clientY - rect.top };
      const point = screenToWorld(camera, viewport, local);
      if (header && noteId) {
        event.preventDefault();
        event.stopPropagation();
        linkContext.menu = {
          kind: "note",
          noteId,
          x: clampMenuPosition(local.x, viewport.width, 196),
          y: clampMenuPosition(local.y, viewport.height, 44),
        };
        linkContext.commandNoteId = noteId;
        linkContext.commandPoint = point;
        return;
      }

      if (target.closest("[data-note-id]")) return;

      event.preventDefault();
      event.stopPropagation();
      linkContext.menu = {
        kind: "board",
        point,
        x: clampMenuPosition(local.x, viewport.width, 224),
        y: clampMenuPosition(local.y, viewport.height, 44),
      };
      linkContext.commandNoteId = null;
      linkContext.commandPoint = point;
    }

    function onWindowClick(event: MouseEvent): void {
      const target = event.target instanceof Element ? event.target : null;
      if (target?.closest('button.command-button[aria-label^="New note"]')) {
        markCreationMenuToolbarTrigger();
        linkContext.commandNoteId = null;
        linkContext.commandPoint = null;
        closeLinkContextMenu();
        return;
      }
      if (target?.closest("[data-link-context-menu]")) return;
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
      boardElement.removeEventListener("contextmenu", onContextMenu, true);
      window.removeEventListener("click", onWindowClick, true);
    };
  });

  function clampMenuPosition(position: number, extent: number, menuExtent: number): number {
    return Math.max(8, Math.min(position + 5, Math.max(8, extent - menuExtent - 8)));
  }

  function coordinateLabel(point: { x: number; y: number }): string {
    return formatPointAddress(point).replace("hive://point/", "");
  }

  const observeAutoHeight: Action<HTMLElement, string> = (element, initialId) => {
    let noteId = initialId;

    const updateMeasuredHeight = () => {
      const note = board.notes[noteId];
      if (!note || note.height !== null) return;

      const height = element.offsetHeight / PX_PER_UNIT;
      if (Number.isFinite(height) && height > 0 && measuredHeights[noteId] !== height) {
        measuredHeights[noteId] = height;
      }
    };

    const observer = new ResizeObserver(updateMeasuredHeight);
    observer.observe(element);

    return {
      update(nextId) {
        if (nextId === noteId) return;
        delete measuredHeights[noteId];
        noteId = nextId;
        observer.disconnect();
        observer.observe(element);
      },
      destroy() {
        observer.disconnect();
        delete measuredHeights[noteId];
      },
    };
  };

  const worldTransform = $derived(
    `translate3d(${viewport.width / 2}px, ${viewport.height / 2}px, 0) ` +
      `scale(${camera.zoom}) ` +
      `translate3d(${-camera.x * PX_PER_UNIT}px, ${-camera.y * PX_PER_UNIT}px, 0)`,
  );
</script>

<div class="notes-layer">
  <div class="notes-world" style:transform={worldTransform}>
    {#each board.order as noteId (noteId)}
      {@const note = board.notes[noteId]}
      {#if note}
        <NoteNode {note} measureHeight={observeAutoHeight} />
      {/if}
    {/each}
  </div>

  {#if linkContext.menu}
    <div
      class="link-context-menu"
      data-selection-ignore
      data-link-context-menu
      role="menu"
      tabindex="-1"
      aria-label={linkContext.menu.kind === "board" ? "Board actions" : "Note actions"}
      style:left={`${linkContext.menu.x}px`}
      style:top={`${linkContext.menu.y}px`}
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
        <button
          type="button"
          role="menuitem"
          onclick={(event) => {
            event.stopPropagation();
            void copyNoteLink(noteId);
            closeLinkContextMenu();
          }}
        >Copy link to note</button>
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
    will-change: transform;
  }

  .link-context-menu {
    display: flex;
    position: absolute;
    z-index: 30;
    width: max-content;
    max-width: calc(100% - 16px);
    min-width: 168px;
    padding: 4px;
    border: 1px solid #4c4c4c;
    border-radius: 4px;
    background: #242424;
    box-shadow: 0 5px 16px rgb(0 0 0 / 45%);
    pointer-events: auto;
  }

  .link-context-menu button {
    width: 100%;
    min-width: 0;
    padding: 6px 8px;
    border: 0;
    border-radius: 2px;
    background: transparent;
    color: var(--text);
    text-align: left;
    white-space: normal;
    cursor: pointer;
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
