<script lang="ts">
  import { onMount } from "svelte";
  import { isTauri } from "@tauri-apps/api/core";
  import { worldToScreen } from "../board/cameraMath";
  import { camera as boardCamera, viewport as boardViewport } from "../board/camera.svelte";
  import type { Note } from "../model/note";
  import { defaultMessageData } from "../messages/data";
  import { prepareMessageSound } from "../messages/sound";
  import TimeNodeBody from "../time/TimeNodeBody.svelte";
  import { activeDropTarget, registerDropTarget, type DropTargetMatch } from "../selection/dropTargets";
  import { comboDropPlanFor, comboInsertCommand, updateEmbeddedMessageSettings } from "./actions.svelte";
  import { comboPullout } from "./gestures.svelte";
  import { comboSectionsFor, sectionExpanded, type ComboSection } from "./logic";
  import { toggleEmbeddedSection } from "./actions.svelte";
  import { COMBO_SECTION_WIDTH_PX } from "./layout";
  import { isComboDropPlan } from "./dropLogic";

  let { note }: { note: Note } = $props();
  let root: HTMLDivElement;
  const desktop = isTauri();
  let dropOwnerId = $derived(`combo:${note.id}`);
  let sections = $derived(comboSectionsFor(note));
  let settings = $derived(note.message ?? defaultMessageData());
  let isDropTarget = $derived($activeDropTarget?.ownerId === dropOwnerId);
  let activePlan = $derived(isComboDropPlan($activeDropTarget?.payload) ? $activeDropTarget.payload : null);
  let dropHint = $derived(activePlan?.direction === "message-into-text-host"
    ? "Drop Note or Task to combine"
    : "Drop Time or Message to combine");

  onMount(() => {
    const unregister = registerDropTarget({
      ownerId: dropOwnerId,
      accepts(noteIds, worldPoint) {
        if (noteIds.length !== 1) return null;
        const sourceId = noteIds[0];
        const host = root.closest<HTMLElement>(".note-card[data-note-id]");
        const plan = comboDropPlanFor(sourceId, note.id);
        if (!plan || !host) return null;
        const boardElement = document.querySelector<HTMLElement>(".board");
        if (!boardElement) return null;
        const boardRect = boardElement.getBoundingClientRect();
        const screen = worldToScreen(boardCamera, boardViewport, worldPoint);
        const clientX = boardRect.left + screen.x;
        const clientY = boardRect.top + screen.y;
        const bounds = host.getBoundingClientRect();
        if (clientX < bounds.left || clientX > bounds.right || clientY < bounds.top || clientY > bounds.bottom) return null;
        return {
          ownerId: dropOwnerId,
          targetId: plan.highlightTextHostId ?? note.id,
          payload: plan,
        };
      },
      drop(_noteIds, match: DropTargetMatch) {
        if (!isComboDropPlan(match.payload)) return null;
        return comboInsertCommand(match.payload.sourceId, match.payload.hostId);
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

<div bind:this={root} class="combo-host" class:combo-host-empty={!isDropTarget && sections.length === 0} data-selection-ignore>
  {#if isDropTarget}
    <div class="combo-drop-hint" role="status">{dropHint}</div>
  {/if}
  {#each sections as section (section)}
    <section
      class="combo-section"
      data-combo-section={section}
      class:drop-target={isDropTarget}
      use:comboPullout={{ noteId: note.id, section }}
    >
      <div class="combo-section-title">
        <span>{section === "message" ? "Message" : "Time"}</span>
        <button
          class="combo-section-toggle"
          type="button"
          aria-label={`${sectionExpanded(note.embedSections, section) ? "Collapse" : "Expand"} ${section} section`}
          aria-expanded={sectionExpanded(note.embedSections, section)}
          onclick={() => toggleEmbeddedSection(note.id, section)}
        >
          <span class="combo-section-chevron" aria-hidden="true">{sectionExpanded(note.embedSections, section) ? "▾" : "▸"}</span>
        </button>
      </div>
      {#if sectionExpanded(note.embedSections, section)}
        <div
          class="combo-section-body"
          data-combo-part-body={section}
          style:width={`${COMBO_SECTION_WIDTH_PX}px`}
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
  /* The divider line and the title row (with the collapse arrow at its end) follow the node width;
     only the section controls keep their fixed width (user, debug 15). */
  .combo-host { display: flex; flex: 0 0 auto; flex-direction: column; align-items: stretch; gap: 0; min-width: 0; width: 100%; margin-top: auto; }
  /* An empty host must not take the row: in module nodes (Importance etc.) the body sits beside it and was squeezed to 0 width. */
  .combo-host.combo-host-empty { display: none; }
  .combo-section { box-sizing: border-box; flex: 0 0 auto; align-self: stretch; min-width: 0; max-width: none; border-top: 1px solid #4b4d52; user-select: none; }
  .combo-section.drop-target { border-color: var(--accent); }
  .combo-section-title {
    display: flex; width: 100%; min-height: 25px; align-items: center; justify-content: space-between; gap: 5px;
    box-sizing: border-box; padding: 3px 2px; color: var(--text-dim);
    font-size: 10px; font-weight: 600;
  }
  .combo-section-toggle {
    display: grid; place-items: center; flex: 0 0 18px; width: 18px; height: 18px;
    padding: 0; border: 0; border-radius: 2px; color: #c7a95e; background: transparent; cursor: pointer;
  }
  .combo-section-toggle:hover, .combo-section-toggle:focus-visible { color: var(--text); background: #ffffff12; }
  .combo-section-chevron { line-height: 1; }
  .combo-section-body { min-width: 0; padding: 1px 0 2px; }
  .combo-message-settings { display: grid; gap: 6px; padding: 2px 0 5px; font-size: 11px; }
  .combo-message-settings label { display: flex; align-items: center; gap: 6px; user-select: none; }
  .combo-message-settings input { accent-color: var(--accent); }
  .combo-message-hint { color: var(--text-dim); font-size: 10px; }
  .combo-drop-hint { padding: 4px 5px; border: 1px dashed var(--accent); color: var(--text-dim); font-size: 10px; }
</style>
