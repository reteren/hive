<script lang="ts">
  import { onMount, tick } from "svelte";
  import { board, updateNote } from "../model/board.svelte";
  import HexColorPicker from "../color/HexColorPicker.svelte";
  import { liveColorSession, type LiveColorSession } from "../color/liveColor";
  import { camera, viewport } from "../board/camera.svelte";
  import { PX_PER_UNIT } from "../board/cameraMath";
  import { BEACON_SIZE, normalizeNoteScale } from "../model/note";
  import { BEACON_PALETTE } from "./beaconPalette";
  import { noteGlowShadow } from "../notes/noteGlowLogic";
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

  let colorSession: LiveColorSession | null = null;
  let colorSessionId: string | null = null;

  function endColorSession(keep: boolean): void {
    colorSession?.finish(keep);
    colorSession = null;
    colorSessionId = null;
  }

  $effect(() => {
    const id = beaconEditor.noteId;
    const mode = beaconEditor.mode;
    const note = id ? board.notes[id] : undefined;
    // Closing the colour editor any way but Esc/Cancel keeps the colour shown live.
    if (colorSession && (mode !== "color" || id !== colorSessionId)) endColorSession(true);
    if (note && mode === "color" && !colorSession) {
      const beaconId = note.id;
      colorSessionId = beaconId;
      colorSession = liveColorSession(
        note.color ?? BEACON_PALETTE[0],
        (color) => updateNote(beaconId, { color }),
        (color) => { recolorBeacon(beaconId, color); },
      );
    }
    draft = note ? (mode === "rename" ? note.name : note.color ?? "") : "";
    if (id) void tick().then(() => {
      if (mode === "rename") { editInput?.focus(); editInput?.select(); }
      else document.querySelector<HTMLElement>("[data-beacon-editor]")?.focus();
    });
  });

  function cancelColor(): void {
    endColorSession(false);
    closeBeaconEditor();
  }

  onMount(() => {
    function onPointerDown(event: PointerEvent): void {
      if (beaconEditor.noteId && event.target instanceof Element && !event.target.closest("[data-beacon-editor]")) closeBeaconEditor();
    }
    function onKeyDown(event: KeyboardEvent): void {
      if (event.key !== "Escape" || !beaconEditor.noteId) return;
      if (beaconEditor.mode === "color") cancelColor();
      else closeBeaconEditor();
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
    renameBeacon(id, draft);
    closeBeaconEditor();
  }
</script>

<div class="beacons-layer">
  <div class="beacons-world" style:transform={worldTransform}>
    {#each board.order as id (id)}
      {@const note = board.notes[id]}
      {#if note?.type === "beacon"}
        {@const memberZone = zones.byId[zoneOf(id) ?? ""]}
        {@const scale = normalizeNoteScale(note.scale)}
        <div
          class="beacon-object"
          data-note-id={id}
          data-kind="beacon"
          data-note-scale={scale === 1 ? undefined : scale}
          data-note-glow={note.glow ? "true" : undefined}
          data-dimmed={isDimmed(id)}
          data-member-zone-id={memberZone?.id}
          style:left={`${note.x * PX_PER_UNIT}px`}
          style:top={`${note.y * PX_PER_UNIT}px`}
          style:width={`${BEACON_SIZE * PX_PER_UNIT}px`}
          style:height={`${BEACON_SIZE * PX_PER_UNIT}px`}
          style:transform={scale === 1 ? undefined : `scale(${scale})`}
          style:transform-origin="top left"
        >
          <button
            class="beacon-circle"
            data-note-header
            type="button"
            aria-label={`Beacon ${note.name}${memberZone ? `, Zone: ${memberZone.name}` : ""}`}
            class:in-zone={Boolean(memberZone)}
            style:--beacon-color={note.color ?? BEACON_PALETTE[0]}
            style:--note-glow-shadow={note.glow ? noteGlowShadow(note.glow) : undefined}
            style:--zone-color={memberZone?.color ?? "transparent"}
            ondblclick={(event) => { event.preventDefault(); event.stopPropagation(); openBeaconEditor(id, "rename"); }}
          ></button>
          {#if isMarked(id)}<span class="beacon-mark" aria-label="Marked beacon"></span>{/if}
          <span class="beacon-label" style:color={note.color ?? BEACON_PALETTE[0]}>{note.name}</span>
          {#if beaconEditor.noteId === id}
            {#if beaconEditor.mode === "color"}
              <div class="beacon-editor" data-beacon-editor data-selection-ignore role="dialog" tabindex="-1" aria-label="Beacon colour"
                onkeydown={(event) => { if (event.key === "Enter" && !(event.target instanceof HTMLInputElement)) { event.preventDefault(); closeBeaconEditor(); } }}>
                <span class="beacon-editor-title">Beacon colour</span>
                <HexColorPicker
                  value={note.color ?? BEACON_PALETTE[0]}
                  label="Beacon colour"
                  oninput={(color) => colorSession?.preview(color)}
                  onchange={(color) => colorSession?.preview(color)}
                />
                <div class="beacon-editor-actions">
                  <button type="button" onclick={cancelColor}>Cancel</button>
                  <button type="button" onclick={closeBeaconEditor}>Done</button>
                </div>
              </div>
            {:else}
              <div class="beacon-editor" data-beacon-editor data-selection-ignore role="dialog" aria-label="Rename beacon">
                <label for="beacon-edit-input">Beacon name</label>
                <input id="beacon-edit-input" bind:this={editInput} bind:value={draft} onkeydown={(event) => { if (event.key === "Enter") { event.preventDefault(); save(); } }} />
                <div class="beacon-editor-actions">
                  <button type="button" onclick={closeBeaconEditor}>Cancel</button>
                  <button type="button" onclick={save}>Save</button>
                </div>
              </div>
            {/if}
          {/if}
        </div>
      {/if}
    {/each}
  </div>
</div>
