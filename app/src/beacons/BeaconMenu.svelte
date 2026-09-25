<script lang="ts">
  import { onMount } from "svelte";
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
  import "./focus.css";

  let beacons = $derived(allBeacons());
  let focused = $derived(validFocused());
  let meContextMenu = $state<null | { x: number; y: number }>(null);

  onMount(() => {
    function onMeContextMenu(event: MouseEvent): void {
      if (!(event.target instanceof Element) || !event.target.closest('[data-beacon-id="me"]')) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      closeLinkContextMenu();
      meContextMenu = {
        x: Math.max(8, Math.min(event.clientX, window.innerWidth - 180)),
        y: Math.max(8, Math.min(event.clientY, window.innerHeight - 84)),
      };
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

  function onOutsideClick(event: PointerEvent): void {
    if (!(event.target instanceof Element)) return;
    if (meContextMenu && !event.target.closest("[data-me-beacon-menu]")) meContextMenu = null;
    if (beaconState.menuOpen && !event.target.closest("[data-beacon-menu], .beacon-menu-toggle")) beaconState.menuOpen = false;
  }
</script>

<svelte:window onkeydown={onEscape} onpointerdown={onOutsideClick} />

<div class="beacon-controls" data-selection-ignore>
  <button
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
  {#if beaconState.menuOpen}
    <div id="beacon-menu" class="beacon-menu" data-beacon-menu role="group" aria-label="Beacon focus">
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
      style:left={`${meContextMenu.x}px`}
      style:top={`${meContextMenu.y}px`}
    >
      <button type="button" role="menuitem" onclick={() => { toggleBeaconMark(ME_OBJECT_ID); meContextMenu = null; }}>
        {beaconMarkActionLabel(ME_OBJECT_ID)}
      </button>
      <button type="button" role="menuitem" onclick={() => { focusBeaconFromMenu(ME_OBJECT_ID); meContextMenu = null; }}>
        {beaconFocusActionLabel(ME_OBJECT_ID)}
      </button>
    </div>
  {/if}
</div>
