<script lang="ts">
  import { board } from "../model/board.svelte";
  import { ME_OBJECT_ID } from "../model/link";
  import { editing } from "../notes/editing.svelte";
  import { creationMenu } from "../notes/creation.svelte";
  import { undoLogPanel } from "../history/history.svelte";
  import { selection } from "../selection/selection.svelte";
  import { linkContext } from "../links-in-text/contextMenu.svelte";
  import { beaconState } from "./beaconState.svelte";
  import { allBeacons, beaconName, clearFocus, setFocused, validFocused } from "./focus.svelte";
  import "./focus.css";

  let beacons = $derived(allBeacons());
  let focused = $derived(validFocused());

  function onEscape(event: KeyboardEvent): void {
    if (event.code !== "Escape" || event.defaultPrevented) return;
    if (beaconState.menuOpen) {
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
    if (!beaconState.menuOpen || !(event.target instanceof Element)) return;
    if (!event.target.closest("[data-beacon-menu], .beacon-menu-toggle")) beaconState.menuOpen = false;
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
</div>
