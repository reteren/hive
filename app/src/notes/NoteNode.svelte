<script lang="ts">
  import { tick } from "svelte";
  import type { Action } from "svelte/action";
  import { NOTE_HEADER_HEIGHT_UNITS, normalizeNoteScale, type Note } from "../model/note";
  import { updateNote } from "../model/board.svelte";
  import { execute } from "../history/history.svelte";
  import { board } from "../model/board.svelte";
  import { editing } from "./editing.svelte";
  import { measuredHeights, MIN_NOTE_HEIGHT } from "./layout.svelte";
  import { PX_PER_UNIT } from "../board/cameraMath";
  import { camera } from "../board/camera.svelte";
  import { uniqueName } from "./naming";
  import { renameCalculatorNode } from "./calculatorRename.svelte";
  import NoteBody from "../editor/NoteBody.svelte";
  import TaskCheckbox from "../tasks/TaskCheckbox.svelte";
  import NoteModules from "../modules/NoteModules.svelte";
  import ModuleNodeBody from "../modules/ModuleNodeBody.svelte";
  import MoodNodeBody from "../moods/MoodNodeBody.svelte";
  import CalendarNodeBody from "../calendar/CalendarNodeBody.svelte";
  import ImageNodeBody from "../images/ImageNodeBody.svelte";
  import PdfNodeBody from "../formats/PdfNodeBody.svelte";
  import FormatNodeBody from "../formats/FormatNodeBody.svelte";
  import AudioNodeBody from "../audio/AudioNodeBody.svelte";
  import VideoNodeBody from "../video/VideoNodeBody.svelte";
  import YoutubeNodeBody from "../youtube/YoutubeNodeBody.svelte";
  import "../video/init";
  import "../youtube/init";
  import { nodeBodyFor } from "./nodeBodies";
  import { effectiveCustomMarkFrameColors, effectiveImportance } from "../modules/moduleActions.svelte";
  import { customMarkGradientFor } from "../markas/markasLogic";
  import { noteColorStyle } from "./noteColorLogic";
  import { setTimeNodeView } from "../time/viewActions.svelte";
  import { canRenameNoteHeader } from "./noteMenu";
  import { startNoteEditing } from "../editor/editorSession";
  import { selection } from "../selection/selection.svelte";
  import { tool } from "../tools/tool.svelte";
  import { zones } from "../model/zones.svelte";
  import { zoneOf } from "../zones/membership.svelte";
  import { isDimmed } from "../beacons/focus.svelte";
  import { listStatisticsWidth, widthWithListStatistics } from "../stats/listStatsLayout";
  import ComboHost from "../combo/ComboHost.svelte";
import { comboPullout } from "../combo/gestures.svelte";
import { activeDropTarget } from "../selection/dropTargets";
import { highlightsComboTextHost, isComboDropPlan } from "../combo/dropLogic";
import { comboHostMinimumWidth, emptyComboBodyMinimumHeight } from "../combo/layout";

  let { note, measureHeight }: { note: Note; measureHeight: Action<HTMLElement, string> } = $props();
  let renaming = $state(false);
  let draftName = $state("");
  let renameInput = $state<HTMLInputElement>();
  let renameError = $state("");
  let memberZone = $derived(zones.byId[zoneOf(note.id) ?? ""]);
  let customMarkFrameColors = $derived(effectiveCustomMarkFrameColors(note.id));
  let customMarkGradient = $derived(customMarkGradientFor(customMarkFrameColors));
  let paint = $derived(noteColorStyle(note));
  let scale = $derived(normalizeNoteScale(note.scale));
  let activeComboDropPlan = $derived(isComboDropPlan($activeDropTarget?.payload) ? $activeDropTarget.payload : null);
  let comboDropTarget = $derived(
    $activeDropTarget?.targetId === note.id && highlightsComboTextHost(activeComboDropPlan, note.id),
  );
  let comboMinimumWidth = $derived(comboHostMinimumWidth(note));
  let comboBodyMinimum = $derived(emptyComboBodyMinimumHeight(note));

  function beginRename(): void {
    draftName = note.name;
    renameError = "";
    editing.noteId = null;
    renaming = true;
    void tick().then(() => {
      renameInput?.focus();
      renameInput?.select();
    });
  }

  function startRename(event: MouseEvent): void {
    if (!canRenameNoteHeader(note.headerHidden)) return;
    if (event.target instanceof Element && event.target.closest("input, button, [data-selection-ignore]")) return;

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

    if (note.type === "calculator") {
      const result = renameCalculatorNode(note.id, draftName);
      if (!result.ok) {
        renameError = result.message;
        return;
      }
      renameError = "";
      renaming = false;
      return;
    }

    const existing = Object.values(board.notes)
      .filter((other) => other.id !== note.id)
      .map((other) => other.name);
    const nextName = uniqueName(draftName, existing);
    const previousName = note.name;
    renameError = "";
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
    renameError = "";
    renaming = false;
  }

  function beginEditingFromDoubleClick(event: MouseEvent): void {
    if (editing.noteId === note.id || !(event.target instanceof Element)) return;
    if (note.type === "importance" || note.type === "purpose" || note.type === "mood" || note.type === "markas" || note.type === "calendar" || note.type === "image" || note.type === "pdf" || note.type === "format" || note.type === "video" || note.type === "youtube") return;
    if (event.target.closest(".note-header, [data-text-link], input, button")) return;
    tool.active = "select";
    startNoteEditing(note.id, { x: event.clientX, y: event.clientY });
  }
</script>

<article
  class="note-card"
  class:list-with-statistics={note.type === "list" && note.listStats === true}
  data-note-id={note.id}
  data-note-scale={scale === 1 ? undefined : scale}
  data-header-hidden={note.headerHidden ? "true" : undefined}
  data-dimmed={isDimmed(note.id)}
  data-editing={editing.noteId === note.id ? "true" : "false"}
  data-kind={note.type}
  data-task={note.task ? (note.task.done ? "done" : "open") : undefined}
  data-importance={effectiveImportance(note.id) ?? undefined}
  data-custom-mark-frame={customMarkFrameColors.length > 0 ? "true" : undefined}
  data-custom-mark-animate={customMarkFrameColors.length > 1 ? "true" : undefined}
  data-member-zone-id={memberZone?.id}
  data-node-color={note.type !== "beacon" && note.color ? "true" : undefined}
  style:--custom-mark-gradient={customMarkGradient}
  style:--note-frame={paint["--note-frame"]}
  style:--note-body={paint["--note-body"]}
  style:--note-header-text={paint["--note-header-text"]}
  style:--text={paint["--text"]}
  style:--text-dim={paint["--text-dim"]}
  style:--note-header-height={`${NOTE_HEADER_HEIGHT_UNITS * PX_PER_UNIT}px`}
  style:transform={`translate(${note.x * PX_PER_UNIT}px, ${note.y * PX_PER_UNIT}px)${scale === 1 ? "" : ` scale(${scale})`}`}
  style:left="0px"
  style:top="0px"
  style:width={`${widthWithListStatistics(note) * PX_PER_UNIT}px`}
  style:min-width={comboMinimumWidth === null ? undefined : `${comboMinimumWidth * PX_PER_UNIT}px`}
  style:--list-statistics-width={`${listStatisticsWidth(note) * PX_PER_UNIT}px`}
  style:height={note.height === null ? "auto" : `${note.height * PX_PER_UNIT}px`}
  style:min-height={note.height === null ? `${MIN_NOTE_HEIGHT * PX_PER_UNIT}px` : "0px"}
  use:measureHeight={`${note.id}\u0000${note.type}\u0000${note.text}`}
  ondblclick={beginEditingFromDoubleClick}
>
  {#if memberZone}
    <div class="zone-marker" data-zone-marker title={memberZone.name} aria-label={`Zone: ${memberZone.name}`} style:--zone-color={memberZone.color}></div>
  {/if}
  {#if note.type !== "image" && !note.headerHidden}
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
          oninput={() => { renameError = ""; }}
          onkeydown={handleRenameKeydown}
          onblur={commitRename}
        />
      {:else}
        <span class="note-name">{note.name}</span>
      {/if}
      {#if note.type === "time"}
        <span class="time-view-switch" role="group" aria-label="Time node view" data-selection-ignore>
          <button
            type="button"
            class:active={note.time?.view !== "stopwatch"}
            aria-pressed={note.time?.view !== "stopwatch"}
            data-selection-ignore
            onclick={() => setTimeNodeView(note.id, "time")}
          >Time</button>
          <button
            type="button"
            class:active={note.time?.view === "stopwatch"}
            aria-pressed={note.time?.view === "stopwatch"}
            data-selection-ignore
            onclick={() => setTimeNodeView(note.id, "stopwatch")}
          >Stopwatch</button>
        </span>
      {/if}
    </header>
  {:else if note.type !== "image"}
    <header class="note-header hidden-note-header" data-note-header data-hidden-note-header data-header-drag-strip aria-hidden="true" ondblclick={startRename}>
      <TaskCheckbox {note} />
      <span class="note-name">{note.name}</span>
      {#if note.type === "time"}
        <span class="time-view-switch" role="group" aria-label="Time node view" data-selection-ignore>
          <button
            type="button"
            class:active={note.time?.view !== "stopwatch"}
            aria-pressed={note.time?.view !== "stopwatch"}
            data-selection-ignore
            onclick={() => setTimeNodeView(note.id, "time")}
          >Time</button>
          <button
            type="button"
            class:active={note.time?.view === "stopwatch"}
            aria-pressed={note.time?.view === "stopwatch"}
            data-selection-ignore
            onclick={() => setTimeNodeView(note.id, "stopwatch")}
          >Stopwatch</button>
        </span>
      {/if}
    </header>
  {/if}
  {#if renameError}
    <div class="rename-error" role="alert">{renameError}</div>
  {/if}
  <NoteModules {note} />
  <div class="note-frame" class:fixed-height={note.height !== null}>
    <div class="note-frame-edge note-frame-edge-top" data-note-header aria-hidden="true"></div>
    <div class="note-frame-edge note-frame-edge-left" data-note-header aria-hidden="true"></div>
    <div
      class="note-content"
      class:empty-auto-body={note.height === null && note.text.trim() === "" && (note.type === "note" || note.type === "pro" || note.type === "con")}
      class:combo-host-content={comboBodyMinimum !== null}
      data-combo-drop-target={comboDropTarget ? "host" : undefined}
      data-note-body
    >
      {#if nodeBodyFor(note.type)}
        {@const CustomBody = nodeBodyFor(note.type)!}
        {#if note.type === "message" && note.time}
          <div class="combo-message-part" data-selection-ignore data-combo-part-body="message" use:comboPullout={{ noteId: note.id, section: "message" }}>
            <CustomBody {note} />
          </div>
        {:else}
          <CustomBody {note} />
        {/if}
      {:else if note.type === "importance" || note.type === "purpose"}
        <ModuleNodeBody {note} />
      {:else if note.type === "mood"}
        <MoodNodeBody {note} />
      {:else if note.type === "calendar"}
        <CalendarNodeBody />
      {:else if note.type === "image"}
        <ImageNodeBody image={note.image} selected={selection.ids.includes(note.id)} name={note.name} noteId={note.id} flipX={note.flipX} flipY={note.flipY} />
      {:else if note.type === "pdf"}
        <PdfNodeBody {note} />
      {:else if note.type === "format"}
        <FormatNodeBody {note} />
      {:else if note.type === "audio"}
        <AudioNodeBody {note} />
      {:else if note.type === "video"}
        <VideoNodeBody {note} />
      {:else if note.type === "youtube"}
        <YoutubeNodeBody {note} />
      {:else}
        <NoteBody {note} />
      {/if}
      <ComboHost {note} />
    </div>
    <div class="note-frame-edge note-frame-edge-right" data-note-header aria-hidden="true"></div>
    <div class="note-frame-edge note-frame-edge-bottom" data-note-header aria-hidden="true"></div>
  </div>
</article>

<style>
  .note-card {
    position: absolute;
    transform-origin: top left;
    isolation: isolate;
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
    min-height: var(--note-header-height);
    /* Debug 20.7: node names (e.g. audio files) are labels, not selectable text; rename uses its own input. */
    user-select: none;
    -webkit-user-select: none;
    align-items: center;
    padding: 0 8px;
    color: var(--note-header-text, #e6e6e6);
    background: var(--note-frame);
    border-bottom: 1px solid #454545;
    font-size: 11px;
    font-weight: 600;
    user-select: none;
  }

  .time-view-switch {
    display: inline-flex;
    flex: 0 0 auto;
    gap: 2px;
    margin-left: auto;
    padding: 2px;
    background: #292929;
    border: 1px solid #4b4b4b;
    border-radius: 999px;
  }

  .time-view-switch button {
    min-height: 17px;
    padding: 1px 7px;
    color: #a0a0a0;
    background: transparent;
    border: 0;
    border-radius: 999px;
    font: inherit;
    font-size: 9px;
    cursor: pointer;
  }

  .time-view-switch button.active {
    color: #f0d58a;
    background: #48402d;
  }

  /* Hidden header stays as a hit target just above the node without covering its body. */
  .hidden-note-header {
    position: absolute;
    z-index: 2;
    bottom: 100%;
    left: -1px;
    box-sizing: border-box;
    width: calc(100% + 2px);
    border-radius: 5px 5px 0 0;
    opacity: 0;
    pointer-events: auto;
  }

  .note-card[data-header-hidden="true"] {
    overflow: visible;
  }

  .note-card[data-header-hidden="true"]:hover > .hidden-note-header {
    opacity: 0.5;
  }

  .note-card[data-header-hidden="true"] > .zone-marker {
    z-index: 3;
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

  .note-card.list-with-statistics > .note-header,
  .note-card.list-with-statistics > .note-frame {
    box-sizing: border-box;
    width: calc(100% - var(--list-statistics-width));
  }

  .rename-error {
    padding: 3px 5px;
    border-top: 1px solid #68433f;
    color: #f0a69c;
    font-size: 11px;
    line-height: 1.3;
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

  .note-card[data-kind="image"] > .note-frame {
    min-height: 0;
    grid-template-columns: minmax(0, 1fr);
    grid-template-rows: minmax(0, 1fr);
    background: transparent;
  }

  .note-card[data-kind="image"] {
    background: transparent;
    border-color: transparent;
    box-shadow: none;
  }

  .note-card[data-kind="image"] .note-frame-edge {
    display: none;
  }

  .note-card[data-kind="image"] .note-content {
    grid-area: 1 / 1;
    min-height: 0;
    padding: 0;
    overflow: hidden;
    background: transparent;
    user-select: none;
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

  .note-content[data-combo-drop-target="host"] {
    outline: 2px solid #f5cd4d;
    outline-offset: -2px;
    background-color: #f5cd4d14;
  }

  .note-content :global(.note-body) {
    min-height: 1em;
  }

  .note-content.combo-host-content {
    display: flex;
    min-height: 0;
    flex-direction: column;
    overflow: visible;
  }

  .note-content.combo-host-content > :global(.note-body) {
    flex: 1 0 auto;
    min-height: 100px;
  }

  .note-content.combo-host-content > :global(.note-body.fixed-height) {
    height: auto;
    min-height: 100px;
    overflow: visible;
  }
</style>
