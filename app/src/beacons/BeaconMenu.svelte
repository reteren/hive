<script lang="ts">
  import { tool } from "../tools/tool.svelte";
  import { onMount } from "svelte";
  import { camera, viewport } from "../board/camera.svelte";
  import { screenToWorld, type Point } from "../board/cameraMath";
  import { boardPopupStyle, dismissBoardPopup, fitBoardPopupAnchor } from "../ui/boardAnchor";
  import { board } from "../model/board.svelte";
  import { ME_OBJECT_ID } from "../model/link";
  import { editing } from "../notes/editing.svelte";
  import { creationMenu } from "../notes/creation.svelte";
  import { undoLogPanel } from "../history/history.svelte";
  import { selection } from "../selection/selection.svelte";
  import { closeLinkContextMenu, linkContext } from "../links-in-text/contextMenu.svelte";
  import { beaconState } from "./beaconState.svelte";
  import { allBeacons, beaconName, clearFocus, setFocused, validFocused } from "./focus.svelte";
  import { beaconFocusActionLabel, beaconMarkActionLabel, focusBeaconFromMenu } from "./focusCommands";
  import { toggleBeaconMark } from "./marks.svelte";
  import { deleteMeBeacon } from "../trash/trashActions.svelte";
  import "./focus.css";

  let beacons = $derived(allBeacons());
  let focused = $derived(validFocused());
  let controls: HTMLDivElement;
  let toggleButton: HTMLButtonElement;
  let beaconAnchor = $state<Point | null>(null);
  let beaconZoomAtOpen = $state(1);
  let meContextMenu = $state<Point | null>(null);
  let meContextMenuZoomAtOpen = $state(1);

  function boardPoint(clientX: number, clientY: number): Point {
    const rect = document.querySelector<HTMLElement>(".board")!.getBoundingClientRect();
    return screenToWorld(camera, viewport, { x: clientX - rect.left, y: clientY - rect.top });
  }

  function anchorBelowToggle(): Point {
    const rect = toggleButton.getBoundingClientRect();
    return fitBoardPopupAnchor(camera, viewport, boardPoint(rect.left, rect.bottom), { width: 230, height: 320 });
  }

  function controlsOrigin(): Point {
    const boardRect = document.querySelector<HTMLElement>(".board")!.getBoundingClientRect();
    const controlsRect = controls.getBoundingClientRect();
    return { x: controlsRect.left - boardRect.left, y: controlsRect.top - boardRect.top };
  }

  $effect(() => {
    if (beaconState.menuOpen && toggleButton && !beaconAnchor) {
      beaconZoomAtOpen = camera.zoom;
      beaconAnchor = anchorBelowToggle();
    }
    else if (!beaconState.menuOpen) beaconAnchor = null;
  });

  onMount(() => {
    function onMeContextMenu(event: MouseEvent): void {
      if (!(event.target instanceof Element) || !event.target.closest('[data-beacon-id="me"]')) return;
      // In draw mode the right button is the eyedropper; drawInput swallows the context menu.
      if (tool.active === "draw") return;
      event.preventDefault();
      event.stopImmediatePropagation();
      closeLinkContextMenu();
      meContextMenuZoomAtOpen = camera.zoom;
      meContextMenu = fitBoardPopupAnchor(camera, viewport, boardPoint(event.clientX, event.clientY), { width: 180, height: 116 });
    }
    window.addEventListener("contextmenu", onMeContextMenu, true);
    return () => window.removeEventListener("contextmenu", onMeContextMenu, true);
  });

  function onEscape(event: KeyboardEvent): void {
    if (event.code !== "Escape" || event.defaultPrevented) return;
    if (meContextMenu) {
      meContextMenu = null;
    } else if (beaconState.menuOpen) {
      beaconState.menuOpen = false;
    } else if (
      focused.length && editing.noteId === null && !creationMenu.open && !undoLogPanel.open &&
      selection.ids.length === 0 && selection.contextPick === null && linkContext.menu === null
    ) {
      clearFocus();
    } else return;
    event.preventDefault();
    event.stopImmediatePropagation();
  }

</script>

<svelte:window onkeydown={onEscape} />

<div class="beacon-controls" data-selection-ignore bind:this={controls}>
  <button
    bind:this={toggleButton}
    class="beacon-menu-toggle"
    type="button"
    aria-label="Beacon menu"
    aria-controls="beacon-menu"
    aria-expanded={beaconState.menuOpen}
    onclick={() => { beaconState.menuOpen = !beaconState.menuOpen; }}
  >Beacons</button>
  {#if focused.length}
    <div class="beacon-focus-indicator" role="status">
      <span>Focus: {focused.map(beaconName).join(", ")}</span>
      <button type="button" aria-label="Exit beacon focus" onclick={clearFocus}>✕</button>
    </div>
  {/if}
  {#if beaconState.menuOpen && beaconAnchor}
    <div id="beacon-menu" class="beacon-menu" data-beacon-menu role="group" aria-label="Beacon focus"
      style={`${boardPopupStyle(camera, viewport, beaconAnchor, beaconZoomAtOpen, controlsOrigin())};position:absolute`}
      use:dismissBoardPopup={{ close: () => { beaconState.menuOpen = false; }, ignoreSelector: ".beacon-menu-toggle", escape: false }}>
      <div class="beacon-menu-title">Beacon focus</div>
      {#each beacons as id (id)}
        <label class="beacon-menu-row">
          <span class="beacon-color" style:background={id === ME_OBJECT_ID ? "var(--accent)" : board.notes[id]?.color ?? "var(--accent)"}></span>
          <span class="beacon-name">{beaconName(id)}</span>
          <input type="checkbox" checked={focused.includes(id)} onchange={(event) => setFocused(id, event.currentTarget.checked)} aria-label={`Focus ${beaconName(id)}`} />
        </label>
      {/each}
    </div>
  {/if}
  {#if meContextMenu}
    <div
      class="me-beacon-context"
      data-me-beacon-menu
      data-selection-ignore
      role="menu"
      aria-label="ME beacon actions"
      style={`${boardPopupStyle(camera, viewport, meContextMenu, meContextMenuZoomAtOpen, controlsOrigin())};position:absolute`}
      use:dismissBoardPopup={{ close: () => { meContextMenu = null; }, escape: false }}
    >
      <button type="button" role="menuitem" onclick={() => { toggleBeaconMark(ME_OBJECT_ID); meContextMenu = null; }}>
        {beaconMarkActionLabel(ME_OBJECT_ID)}
      </button>
      <button type="button" role="menuitem" onclick={() => { focusBeaconFromMenu(ME_OBJECT_ID); meContextMenu = null; }}>
        {beaconFocusActionLabel(ME_OBJECT_ID)}
      </button>
      <button type="button" role="menuitem" data-me-delete onclick={() => { deleteMeBeacon(); meContextMenu = null; }}>Delete ME</button>
    </div>
  {/if}
</div>
