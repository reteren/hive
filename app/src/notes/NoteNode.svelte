<script lang="ts">
  import { tick } from "svelte";
  import type { Action } from "svelte/action";
  import type { Note } from "../model/note";
  import { updateNote } from "../model/board.svelte";
  import { execute } from "../history/history.svelte";
  import { board } from "../model/board.svelte";
  import { editing } from "./editing.svelte";
  import { MIN_NOTE_HEIGHT } from "./layout.svelte";
  import { PX_PER_UNIT } from "../board/cameraMath";
  import { uniqueName } from "./naming";
  import NoteBody from "../editor/NoteBody.svelte";
  import TaskCheckbox from "../tasks/TaskCheckbox.svelte";
  import NoteModules from "../modules/NoteModules.svelte";
  import ModuleNodeBody from "../modules/ModuleNodeBody.svelte";
  import MoodNodeBody from "../moods/MoodNodeBody.svelte";
  import { effectiveImportance } from "../modules/moduleActions.svelte";
  import { startNoteEditing } from "../editor/editorSession";
  import { tool } from "../tools/tool.svelte";
  import { zones } from "../model/zones.svelte";
  import { zoneOf } from "../zones/membership.svelte";
  import { isDimmed } from "../beacons/focus.svelte";

  let { note, measureHeight }: { note: Note; measureHeight: Action<HTMLElement, string> } = $props();
  let renaming = $state(false);
  let draftName = $state("");
  let renameInput = $state<HTMLInputElement>();
  let memberZone = $derived(zones.byId[zoneOf(note.id) ?? ""]);

  function beginRename(): void {
    draftName = note.name;
    editing.noteId = null;
    renaming = true;
    void tick().then(() => {
      renameInput?.focus();
      renameInput?.select();
    });
  }

  function startRename(event: MouseEvent): void {
    if (event.target instanceof Element && event.target.closest("input")) return;

    event.preventDefault();
    event.stopPropagation();
    beginRename();
  }

  function handleRenameKeydown(event: KeyboardEvent): void {
    if (event.code === "Enter") {
      event.preventDefault();
      event.stopPropagation();
      commitRename();
    } else if (event.code === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      cancelRename();
    }
  }

  function handleHeaderKeydown(event: KeyboardEvent): void {
    if (event.target !== event.currentTarget || !["Enter", "Space"].includes(event.code)) return;

    event.preventDefault();
    beginRename();
  }

  function commitRename(): void {
    if (!renaming) return;

    const existing = Object.values(board.notes)
      .filter((other) => other.id !== note.id)
      .map((other) => other.name);
    const nextName = uniqueName(draftName, existing);
    const previousName = note.name;
    renaming = false;

    if (nextName === previousName) return;

    execute({
      label: "Rename",
      target: nextName,
      do: () => updateNote(note.id, { name: nextName }),
      undo: () => updateNote(note.id, { name: previousName }),
    });
  }

  function cancelRename(): void {
    draftName = note.name;
    renaming = false;
  }

  function beginEditingFromDoubleClick(event: MouseEvent): void {
    if (editing.noteId === note.id || !(event.target instanceof Element)) return;
    if (note.type === "importance" || note.type === "purpose" || note.type === "mood") return;
    if (event.target.closest(".note-header, [data-text-link], input, button")) return;
    tool.active = "select";
    startNoteEditing(note.id, { x: event.clientX, y: event.clientY });
  }
</script>

<article
  class="note-card"
  data-note-id={note.id}
  data-dimmed={isDimmed(note.id)}
  data-editing={editing.noteId === note.id ? "true" : "false"}
  data-kind={note.type}
  data-task={note.task ? (note.task.done ? "done" : "open") : undefined}
  data-importance={effectiveImportance(note.id) ?? undefined}
  data-member-zone-id={memberZone?.id}
  style:left={`${note.x * PX_PER_UNIT}px`}
  style:top={`${note.y * PX_PER_UNIT}px`}
  style:width={`${note.width * PX_PER_UNIT}px`}
  style:height={note.height === null ? "auto" : `${note.height * PX_PER_UNIT}px`}
  style:min-height={note.height === null ? `${MIN_NOTE_HEIGHT * PX_PER_UNIT}px` : "0px"}
  use:measureHeight={note.id}
  ondblclick={beginEditingFromDoubleClick}
>
  {#if memberZone}
    <div class="zone-marker" data-zone-marker title={memberZone.name} aria-label={`Zone: ${memberZone.name}`} style:--zone-color={memberZone.color}></div>
  {/if}
  <header
    class="note-header"
    data-note-header
    role="button"
    tabindex="0"
    ondblclick={startRename}
    onkeydown={handleHeaderKeydown}
  >
    <TaskCheckbox {note} />
    {#if renaming}
      <input
        bind:this={renameInput}
        bind:value={draftName}
        class="rename-input"
        aria-label="Note name"
        onkeydown={handleRenameKeydown}
        onblur={commitRename}
      />
    {:else}
      <span class="note-name">{note.name}</span>
    {/if}
  </header>
  <NoteModules {note} />
  <div class="note-frame" class:fixed-height={note.height !== null}>
    <div class="note-frame-edge note-frame-edge-top" data-note-header aria-hidden="true"></div>
    <div class="note-frame-edge note-frame-edge-left" data-note-header aria-hidden="true"></div>
    <div
      class="note-content"
      class:empty-auto-body={note.height === null && note.text.trim() === "" && (note.type === "note" || note.type === "pro" || note.type === "con")}
      data-note-body
    >
      {#if note.type === "importance" || note.type === "purpose"}
        <ModuleNodeBody {note} />
      {:else if note.type === "mood"}
        <MoodNodeBody {note} />
      {:else}
        <NoteBody {note} />
      {/if}
    </div>
    <div class="note-frame-edge note-frame-edge-right" data-note-header aria-hidden="true"></div>
    <div class="note-frame-edge note-frame-edge-bottom" data-note-header aria-hidden="true"></div>
  </div>
</article>

<style>
  .note-card {
    position: absolute;
    display: flex;
    flex-direction: column;
    overflow: hidden;
    color: var(--text);
    background: var(--note-frame);
    border: 1px solid #414141;
    border-radius: 5px;
    box-shadow: 0 3px 12px rgb(0 0 0 / 28%);
    pointer-events: auto;
    user-select: text;
  }

  .note-header {
    display: flex;
    min-height: 28px;
    align-items: center;
    padding: 0 8px;
    color: #e6e6e6;
    background: var(--note-frame);
    border-bottom: 1px solid #454545;
    font-size: 11px;
    font-weight: 600;
    user-select: none;
  }

  .note-frame {
    display: grid;
    min-height: 30px;
    flex: 1 0 auto;
    grid-template-columns: 6px minmax(0, 1fr) 6px;
    grid-template-rows: 6px minmax(18px, 1fr) 6px;
    background: var(--note-frame);
  }

  .note-frame.fixed-height {
    min-height: 0;
    flex: 1 1 auto;
    grid-template-rows: 6px minmax(0, 1fr) 6px;
  }

  .note-frame-edge {
    background: var(--note-frame);
    user-select: none;
  }

  .note-frame-edge-top {
    grid-area: 1 / 1 / 2 / 4;
  }

  .note-frame-edge-left {
    grid-area: 2 / 1 / 3 / 2;
  }

  .note-frame-edge-right {
    grid-area: 2 / 3 / 3 / 4;
  }

  .note-frame-edge-bottom {
    grid-area: 3 / 1 / 4 / 4;
  }

  .note-name {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .rename-input {
    width: 100%;
    min-width: 0;
    padding: 2px 3px;
    color: var(--text);
    background: #202020;
    border: 1px solid var(--accent);
    border-radius: 2px;
    font: inherit;
    user-select: text;
  }

  .note-content {
    min-width: 0;
    min-height: 18px;
    grid-area: 2 / 2;
    padding: 7px 8px 9px;
    background: var(--note-body);
    overflow-wrap: anywhere;
    user-select: text;
  }

  .zone-marker {
    position: absolute;
    z-index: 1;
    top: 0;
    right: 3px;
    left: 3px;
    height: 3px;
    border-radius: 0 0 2px 2px;
    background: var(--zone-color);
  }

  .note-content.empty-auto-body {
    min-height: 40px;
  }

  .note-content :global(.note-body) {
    min-height: 1em;
  }
</style>
