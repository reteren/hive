<script lang="ts">
  import { onMount, tick } from "svelte";
  import { board } from "../model/board.svelte";
  import { camera, viewport } from "../board/camera.svelte";
  import { PX_PER_UNIT } from "../board/cameraMath";
  import { BEACON_SIZE } from "../model/note";
  import { BEACON_PALETTE, normalizeBeaconColor } from "./beaconPalette";
  import { beaconEditor, closeBeaconEditor, openBeaconEditor, recolorBeacon, renameBeacon } from "./beaconActions.svelte";
  import { isDimmed } from "./focus.svelte";
  import { isMarked } from "./marks.svelte";
  import { zoneOf } from "../zones/membership.svelte";
  import { zones } from "../model/zones.svelte";
  import "./beacons.css";

  let draft = $state("");
  let editInput = $state<HTMLInputElement>();
  const worldTransform = $derived(
    `translate(${viewport.width / 2}px, ${viewport.height / 2}px) ` +
    `scale(${camera.zoom}) ` +
    `translate(${-camera.x * PX_PER_UNIT}px, ${-camera.y * PX_PER_UNIT}px)`,
  );

  $effect(() => {
    const id = beaconEditor.noteId;
    const mode = beaconEditor.mode;
    const note = id ? board.notes[id] : undefined;
    draft = note ? (mode === "rename" ? note.name : note.color ?? "") : "";
    if (id) void tick().then(() => { editInput?.focus(); if (mode === "rename") editInput?.select(); });
  });

  onMount(() => {
    function onPointerDown(event: PointerEvent): void {
      if (beaconEditor.noteId && event.target instanceof Element && !event.target.closest("[data-beacon-editor]")) closeBeaconEditor();
    }
    function onKeyDown(event: KeyboardEvent): void {
      if (event.key !== "Escape" || !beaconEditor.noteId) return;
      closeBeaconEditor();
      event.preventDefault();
      event.stopPropagation();
    }
    window.addEventListener("pointerdown", onPointerDown, true);
    window.addEventListener("keydown", onKeyDown, true);
    return () => {
      window.removeEventListener("pointerdown", onPointerDown, true);
      window.removeEventListener("keydown", onKeyDown, true);
    };
  });

  function save(): void {
    const id = beaconEditor.noteId;
    if (!id) return;
    if (beaconEditor.mode === "rename") renameBeacon(id, draft);
    else if (!recolorBeacon(id, draft) && !normalizeBeaconColor(draft)) return;
    closeBeaconEditor();
  }
</script>

<div class="beacons-layer">
  <div class="beacons-world" style:transform={worldTransform}>
    {#each board.order as id (id)}
      {@const note = board.notes[id]}
      {#if note?.type === "beacon"}
        {@const memberZone = zones.byId[zoneOf(id) ?? ""]}
        <div
          class="beacon-object"
          data-note-id={id}
          data-kind="beacon"
          data-dimmed={isDimmed(id)}
          data-member-zone-id={memberZone?.id}
          style:left={`${note.x * PX_PER_UNIT}px`}
          style:top={`${note.y * PX_PER_UNIT}px`}
          style:width={`${BEACON_SIZE * PX_PER_UNIT}px`}
          style:height={`${BEACON_SIZE * PX_PER_UNIT}px`}
        >
          <button
            class="beacon-circle"
            data-note-header
            type="button"
            aria-label={`Beacon ${note.name}${memberZone ? `, Zone: ${memberZone.name}` : ""}`}
            class:in-zone={Boolean(memberZone)}
            style:--beacon-color={note.color ?? BEACON_PALETTE[0]}
            style:--zone-color={memberZone?.color ?? "transparent"}
            ondblclick={(event) => { event.preventDefault(); event.stopPropagation(); openBeaconEditor(id, "rename"); }}
          ></button>
          {#if isMarked(id)}<span class="beacon-mark" aria-label="Marked beacon"></span>{/if}
          <span class="beacon-label" style:color={note.color ?? BEACON_PALETTE[0]}>{note.name}</span>
          {#if beaconEditor.noteId === id}
            <div class="beacon-editor" data-beacon-editor data-selection-ignore role="dialog" aria-label={beaconEditor.mode === "rename" ? "Rename beacon" : "Beacon colour"}>
              <label for="beacon-edit-input">{beaconEditor.mode === "rename" ? "Beacon name" : "Colour (hex)"}</label>
              {#if beaconEditor.mode === "color"}
                <div class="beacon-palette" aria-label="Beacon colours">
                  {#each BEACON_PALETTE as color}
                    <button type="button" class="beacon-swatch" style:background={color} aria-label={`Colour ${color}`} aria-pressed={draft.toLowerCase() === color} onclick={() => { draft = color; }}></button>
                  {/each}
                </div>
              {/if}
              <input id="beacon-edit-input" bind:this={editInput} bind:value={draft} aria-invalid={beaconEditor.mode === "color" && !normalizeBeaconColor(draft)} onkeydown={(event) => { if (event.key === "Enter") { event.preventDefault(); save(); } }} />
              <div class="beacon-editor-actions">
                <button type="button" onclick={closeBeaconEditor}>Cancel</button>
                <button type="button" onclick={save}>Save</button>
              </div>
            </div>
          {/if}
        </div>
      {/if}
    {/each}
  </div>
</div>
