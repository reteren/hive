<script lang="ts">
  import { onMount } from "svelte";
  import type { Action } from "svelte/action";
  import { viewport } from "./camera.svelte";
  import { attachCameraInput } from "./cameraInput";
  import GridLayer from "./GridLayer.svelte";
  import ZonesLayer from "../zones/ZonesLayer.svelte";
  import ZoneBrushLayer from "../zones/ZoneBrushLayer.svelte";
  import BrushPanel from "../zones/BrushPanel.svelte";
  import DrawingLayer from "../drawing/DrawingLayer.svelte";
  import BeaconsLayer from "../beacons/BeaconsLayer.svelte";
  import LinksLayer from "../links/LinksLayer.svelte";
  import "../links/commands";
  import SelectionOverlay from "../drawing/SelectionOverlay.svelte";
  import MeMarker from "./MeMarker.svelte";
  import NotesLayer from "../notes/NotesLayer.svelte";
  import OverviewZoneLabels from "../overview/OverviewZoneLabels.svelte";
  import OverviewNodes from "../overview/OverviewNodes.svelte";
  import SelectionLayer from "../selection/SelectionLayer.svelte";
  import CreateMenu from "../notes/CreateMenu.svelte";
  import { editing } from "../notes/editing.svelte";
  import { creationMenu } from "../notes/creation.svelte";
  import { isTextEditingTarget } from "../commands/focus";
  import { resolveBoardEscapeAction } from "../selection/escapePriority";
  import { closeUndoLog, undoLogPanel } from "../history/history.svelte";
  import { cancelLineDraft } from "../links/interaction.svelte";
  import { isLineTool, tool } from "../tools/tool.svelte";
  import { selection } from "../selection/selection.svelte";
  import { closeLinkContextMenu, linkContext } from "../links-in-text/contextMenu.svelte";
  import { resolveLineToolEscapeAction } from "../search/escapePriority";

  let board: HTMLDivElement;

  /**
   * Where the primary button went down. A click is dispatched to the common ancestor of the press
   * and release targets, so dragging a text selection out of a note and releasing over the board
   * produces a "board click" — it must not end the note's editing.
   */
  let pressStartedInNote = false;
  const rememberPressOrigin = (event: PointerEvent): void => {
    if (event.button !== 0) return;
    pressStartedInNote = event.target instanceof Element && event.target.closest("[data-note-id]") !== null;
  };

  const boardSurface: Action<HTMLDivElement> = (element) => {
    element.addEventListener("pointerdown", rememberPressOrigin, true);
    element.addEventListener("click", onBoardClick);
    return {
      destroy: () => {
        element.removeEventListener("pointerdown", rememberPressOrigin, true);
        element.removeEventListener("click", onBoardClick);
      },
    };
  };

  onMount(() => {
    const observer = new ResizeObserver(([entry]) => {
      viewport.width = entry.contentRect.width;
      viewport.height = entry.contentRect.height;
    });
    observer.observe(board);
    const detachInput = attachCameraInput(board);
    window.addEventListener("keydown", onKeydown, true);
    return () => {
      observer.disconnect();
      detachInput();
      window.removeEventListener("keydown", onKeydown, true);
    };
  });

  function onBoardClick(event: MouseEvent): void {
    if (!(event.target instanceof Element)) return;
    if (event.target.closest("[data-note-id], [data-create-menu], [data-selection-ignore]")) return;
    if (pressStartedInNote) return;

    editing.noteId = null;
    if (!creationMenu.pinned) creationMenu.open = false;
  }

  function onKeydown(event: KeyboardEvent): void {
    if (event.code !== "Escape" || event.defaultPrevented) return;

    const action = resolveBoardEscapeAction({
      textEditingTarget: isTextEditingTarget(event.target) || isTextEditingTarget(document.activeElement),
      editorOpen: editing.noteId !== null,
      createMenuOpen: creationMenu.open,
      undoLogOpen: undoLogPanel.open,
    });

    if (action === "close-editor") {
      editing.noteId = null;
      event.preventDefault();
    } else if (action === "close-create-menu") {
      creationMenu.open = false;
      creationMenu.pinned = false;
      event.preventDefault();
    } else if (action === "close-undo-log") {
      closeUndoLog();
      event.preventDefault();
    } else if (action === "pass-through" && isLineTool()) {
      const escapeAction = resolveLineToolEscapeAction({
        focusedFloatingUi: isFocusedEscapeOverlay(event.target) || isFocusedEscapeOverlay(document.activeElement),
        contextMenuOpen: linkContext.menu !== null,
        selectionContextPickOpen: selection.contextPick !== null,
        lineToolActive: isLineTool(),
      });
      if (escapeAction === "close-context-menu") {
        closeLinkContextMenu();
        event.preventDefault();
        event.stopPropagation();
      } else if (escapeAction === "cancel-line-tool") {
        tool.active = "select";
        cancelLineDraft();
        event.preventDefault();
      }
    }
  }

  function isFocusedEscapeOverlay(target: EventTarget | null): boolean {
    if (!(target instanceof Element)) return false;
    const overlay = target.closest(
      "dialog, [role='dialog'], [role='menu'], [role='alertdialog'], [data-selection-ignore], #undo-log-panel, .selection-context-pick",
    );
    if (!overlay) return false;
    return !overlay.closest(".search-trigger, .objects-tab");
  }
</script>

<div
  class="board"
  bind:this={board}
  use:boardSurface
  tabindex="-1"
  role="application"
>
  <GridLayer />
  <ZonesLayer />
  <ZoneBrushLayer />
  <DrawingLayer />
  <SelectionOverlay />
  <BrushPanel />
  <LinksLayer />
  <MeMarker />
  <BeaconsLayer />
  <NotesLayer />
  <OverviewNodes />
  <OverviewZoneLabels />
  <SelectionLayer />
  <CreateMenu />
</div>

<style>
  .board {
    position: relative;
    width: 100%;
    height: 100%;
    overflow: hidden;
    background: var(--bg-board);
    outline: none;
  }
</style>
