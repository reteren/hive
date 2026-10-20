<script lang="ts">
  import { isScreenColorPicking } from "../color/screenPicker.svelte";
  import { onMount, tick } from "svelte";
  import { board, onBoardMutation, updateNote } from "../model/board.svelte";
  import HexColorPicker from "../color/HexColorPicker.svelte";
  import { liveColorSession, type LiveColorSession } from "../color/liveColor";
  import { camera, viewport } from "../board/camera.svelte";
  import { lod, visible } from "../board/visibility.svelte";
  import { PX_PER_UNIT } from "../board/cameraMath";
  import { BEACON_SIZE, normalizeNoteScale } from "../model/note";
  import { BEACON_PALETTE } from "./beaconPalette";
  import { defaultBeaconGlow, noteGlowShadow } from "../notes/noteGlowLogic";
  import { beaconEditor, closeBeaconEditor, openBeaconEditor, recolorBeacon, renameBeacon } from "./beaconActions.svelte";
  import { isDimmed } from "./focus.svelte";
  import { isMarked } from "./marks.svelte";
  import { zoneOf } from "../zones/membership.svelte";
  import { zones } from "../model/zones.svelte";
  import { selection } from "../selection/selection.svelte";
  import { validFocused } from "./focus.svelte";

  const noteOrder = new Map(board.order.map((id, index) => [id, index]));
  onBoardMutation((ids) => {
    if (ids === null || ids.some((id) => !board.notes[id] || !noteOrder.has(id))) {
      noteOrder.clear();
      for (let index = 0; index < board.order.length; index += 1) noteOrder.set(board.order[index]!, index);
    }
  });

  let beaconIds = $derived.by(() => {
    const ids = new Set(lod.tier === "min" ? [] : visible.ids);
    for (const id of selection.ids) ids.add(id);
    for (const id of validFocused()) ids.add(id);
    if (beaconEditor.noteId) ids.add(beaconEditor.noteId);
    return [...ids].filter((id) => board.notes[id]?.type === "beacon")
      .sort((first, second) => (noteOrder.get(first) ?? -1) - (noteOrder.get(second) ?? -1));
  });
  import "./beacons.css";
  import { t } from "../i18n/i18n.svelte";

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
      // The palette's eyedropper overlay takes the click; the editor stays open.
      if (isScreenColorPicking()) return;
      if (beaconEditor.noteId && event.target instanceof Element && !event.target.closest("[data-beacon-editor]")) {
        if (beaconEditor.mode === "color") endColorSession(true);
        closeBeaconEditor();
      }
    }
    function onKeyDown(event: KeyboardEvent): void {
      if (event.key !== "Escape" || !beaconEditor.noteId || isScreenColorPicking()) return;
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
    {#each beaconIds as id (id)}
      {@const note = board.notes[id]}
      {#if note?.type === "beacon"}
        {@const color = note.color ?? BEACON_PALETTE[0]}
        {@const glow = defaultBeaconGlow(note)}
        {@const memberZone = zones.byId[zoneOf(id) ?? ""]}
        {@const scale = normalizeNoteScale(note.scale)}
        <div
          class="beacon-object"
          data-note-id={id}
          data-kind="beacon"
          data-note-scale={scale === 1 ? undefined : scale}
          data-note-glow="true"
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
            aria-label={t("Beacon {name}{value}", { name: note.name, value: memberZone ? `, Zone: ${memberZone.name}` : "" })}
            class:in-zone={Boolean(memberZone)}
            style:--beacon-color={color}
            style:--note-glow-shadow={noteGlowShadow(glow)}
            style:--zone-color={memberZone?.color ?? "transparent"}
            ondblclick={(event) => { event.preventDefault(); event.stopPropagation(); openBeaconEditor(id, "rename"); }}
          ></button>
          {#if isMarked(id)}<span class="beacon-mark" aria-label={t("Marked beacon")}></span>{/if}
          {#if lod.tier === "full" || selection.ids.includes(id) || validFocused().includes(id)}
            <span class="beacon-label" style:color={color}>{note.name}</span>
          {/if}
          {#if beaconEditor.noteId === id}
            {#if beaconEditor.mode === "color"}
              <div class="beacon-editor" data-beacon-editor data-selection-ignore role="dialog" tabindex="-1" aria-label={t("Beacon colour")}
                onkeydown={(event) => { if (event.key === "Enter" && !(event.target instanceof HTMLInputElement)) { event.preventDefault(); closeBeaconEditor(); } }}>
                <span class="beacon-editor-title">{t("Beacon colour")}</span>
                <HexColorPicker
                  value={note.color ?? BEACON_PALETTE[0]}
                  label={t("Beacon colour")}
                  oninput={(color) => colorSession?.preview(color)}
                  onchange={(color) => colorSession?.preview(color)}
                />
                <div class="beacon-editor-actions">
                  <button type="button" onclick={cancelColor}>{t("Cancel")}</button>
                  <button type="button" onclick={closeBeaconEditor}>{t("Done")}</button>
                </div>
              </div>
            {:else}
              <div class="beacon-editor" data-beacon-editor data-selection-ignore role="dialog" aria-label={t("Rename beacon")}>
                <label for="beacon-edit-input">{t("Beacon name")}</label>
                <input id="beacon-edit-input" bind:this={editInput} bind:value={draft} onkeydown={(event) => { if (event.key === "Enter") { event.preventDefault(); save(); } }} />
                <div class="beacon-editor-actions">
                  <button type="button" onclick={closeBeaconEditor}>{t("Cancel")}</button>
                  <button type="button" onclick={save}>{t("Save")}</button>
                </div>
              </div>
            {/if}
          {/if}
        </div>
      {/if}
    {/each}
  </div>
</div>
