<script lang="ts">
  import { onMount } from "svelte";
  import { isTauri } from "@tauri-apps/api/core";
  import { worldToScreen } from "../board/cameraMath";
  import { camera as boardCamera, viewport as boardViewport } from "../board/camera.svelte";
  import { board } from "../model/board.svelte";
  import type { Note } from "../model/note";
  import { defaultMessageData } from "../messages/data";
  import { prepareMessageSound } from "../messages/sound";
  import TimeNodeBody from "../time/TimeNodeBody.svelte";
  import { activeDropTarget, registerDropTarget, type DropTargetMatch } from "../selection/dropTargets";
  import { canHostCombo, comboInsertCommand, updateEmbeddedMessageSettings } from "./actions.svelte";
  import { comboPullout } from "./gestures.svelte";
  import { comboSectionsFor, sectionExpanded, type ComboSection } from "./logic";
  import { toggleEmbeddedSection } from "./actions.svelte";

  let { note }: { note: Note } = $props();
  let root: HTMLDivElement;
  const desktop = isTauri();
  let dropOwnerId = $derived(`combo:${note.id}`);
  let sections = $derived(comboSectionsFor(note));
  let settings = $derived(note.message ?? defaultMessageData());
  let isDropTarget = $derived($activeDropTarget?.ownerId === dropOwnerId);

  onMount(() => {
    const unregister = registerDropTarget({
      ownerId: dropOwnerId,
      accepts(noteIds, worldPoint) {
        if (noteIds.length !== 1) return null;
        const sourceId = noteIds[0];
        const host = root.closest<HTMLElement>(".note-card[data-note-id]");
        if (!board.notes[sourceId] || !host || !canHostCombo(sourceId, note.id)) return null;
        const boardElement = document.querySelector<HTMLElement>(".board");
        if (!boardElement) return null;
        const boardRect = boardElement.getBoundingClientRect();
        const screen = worldToScreen(boardCamera, boardViewport, worldPoint);
        const clientX = boardRect.left + screen.x;
        const clientY = boardRect.top + screen.y;
        const bounds = host.getBoundingClientRect();
        if (clientX < bounds.left || clientX > bounds.right || clientY < bounds.top || clientY > bounds.bottom) return null;
        return { ownerId: dropOwnerId, targetId: note.id, payload: sourceId };
      },
      drop(_noteIds, match: DropTargetMatch) {
        return typeof match.payload === "string" ? comboInsertCommand(match.payload, note.id) : null;
      },
    });
    return () => {
      unregister();
    };
  });

  function toggleSettings(event: Event, key: "sound" | "overhive"): void {
    const checked = (event.currentTarget as HTMLInputElement).checked;
    updateEmbeddedMessageSettings(note.id, { [key]: checked });
    if (key === "sound" && checked) void prepareMessageSound();
  }

</script>

<div bind:this={root} class="combo-host" data-selection-ignore>
  {#if isDropTarget}
    <div class="combo-drop-hint" role="status">Drop Time or Message to combine</div>
  {/if}
  {#each sections as section (section)}
    <section class="combo-section" data-combo-section={section} class:drop-target={isDropTarget}>
      <button
        class="combo-section-title"
        type="button"
        aria-expanded={sectionExpanded(note.embedSections, section)}
        onclick={() => toggleEmbeddedSection(note.id, section)}
      >
        <span class="combo-section-chevron" aria-hidden="true">{sectionExpanded(note.embedSections, section) ? "▾" : "▸"}</span>
        {section === "message" ? "Message" : "Time"}
      </button>
      {#if sectionExpanded(note.embedSections, section)}
        <div
          class="combo-section-body"
          data-combo-part-body={section}
          use:comboPullout={{ noteId: note.id, section }}
        >
          {#if section === "message"}
            <div class="combo-message-settings" role="group" aria-label="Message settings">
              <label><input type="checkbox" checked={settings.sound} onchange={(event) => toggleSettings(event, "sound")} /> Sound</label>
              <label><input type="checkbox" checked={settings.overhive} disabled={!desktop} onchange={(event) => toggleSettings(event, "overhive")} /> Overhive</label>
              {#if !desktop}<span class="combo-message-hint">Overhive is available in the desktop app.</span>{/if}
            </div>
          {:else}
            <TimeNodeBody {note} embedded />
          {/if}
        </div>
      {/if}
    </section>
  {/each}
</div>

<style>
  .combo-host { display: grid; gap: 0; min-width: 0; }
  .combo-section { min-width: 0; }
  .combo-section.drop-target { border-color: var(--accent); }
  .combo-section-title {
    display: flex; width: 100%; min-height: 25px; align-items: center; gap: 5px;
    padding: 4px 2px; border: 0; border-top: 1px solid #4b4d52; background: transparent; color: var(--text-dim);
    font: inherit; font-size: 10px; font-weight: 600; text-align: left; cursor: pointer;
  }
  .combo-section-title:hover, .combo-section-title:focus-visible { color: var(--text); }
  .combo-section-chevron { width: 10px; color: #c7a95e; }
  .combo-section-body { min-width: 0; padding: 1px 0 2px; }
  .combo-message-settings { display: grid; gap: 6px; padding: 2px 0 5px; font-size: 11px; }
  .combo-message-settings label { display: flex; align-items: center; gap: 6px; user-select: none; }
  .combo-message-settings input { accent-color: var(--accent); }
  .combo-message-hint { color: var(--text-dim); font-size: 10px; }
  .combo-drop-hint { padding: 4px 5px; border: 1px dashed var(--accent); color: var(--text-dim); font-size: 10px; }
</style>
