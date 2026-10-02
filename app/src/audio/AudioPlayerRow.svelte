<script lang="ts">
  import { onDestroy, tick } from "svelte";
  import type { MediaRef } from "../attachments/types";
  import { attachmentUrl, exportAttachmentAs } from "../attachments/service";
  import { MediaIcon, MediaSlider, MediaTime } from "../media-ui";
  import { dropAudioRecordingOnBoard } from "./recording.svelte";
  import { formatMediaTime } from "../media-ui/time";
  import {
    beginRecordingDrag,
    finishRecordingDrag,
    moveRecordingDrag,
    type RecordingDragGesture,
  } from "./recordingLogic";

  interface Props {
    media: MediaRef;
    name: string;
    recordingId?: string;
    sourceNoteId?: string;
    draggable?: boolean;
    onrename?: (name: string) => void;
    ondelete?: () => void;
  }

  let { media, name, recordingId, sourceNoteId, draggable = false, onrename, ondelete }: Props = $props();
  let audio = $state<HTMLAudioElement | null>(null);
  let playing = $state(false);
  let currentTime = $state(0);
  let duration = $state(0);
  let mediaDuration = $derived(media.duration ?? 0);
  let buffered = $state(0);
  let volume = $state(1);
  let muted = $state(false);
  let editing = $state(false);
  let draftName = $state("");
  let renameInput = $state<HTMLInputElement | null>(null);
  let dragGesture = $state<RecordingDragGesture | null>(null);
  let dragGhostElement: HTMLDivElement | null = null;
  let source = $derived(attachmentUrl(media.file));
  let safeDuration = $derived(Number.isFinite(duration) && duration > 0 ? duration : mediaDuration);

  async function togglePlayback(): Promise<void> {
    if (!audio) return;
    if (audio.paused) {
      try {
        await audio.play();
      } catch {
        playing = false;
      }
    } else {
      audio.pause();
    }
  }

  function seek(value: number): void {
    if (!audio) return;
    audio.currentTime = value;
    currentTime = value;
  }

  function changeVolume(value: number): void {
    volume = value;
    muted = false;
    if (!audio) return;
    audio.volume = value;
    audio.muted = false;
  }

  function toggleMute(): void {
    if (muted || volume === 0) {
      if (volume === 0) {
        volume = 0.75;
        if (audio) audio.volume = volume;
      }
      muted = false;
    } else {
      muted = true;
    }
    if (audio) audio.muted = muted;
  }

  function syncTime(): void {
    if (!audio) return;
    currentTime = audio.currentTime;
    duration = Number.isFinite(audio.duration) ? audio.duration : media.duration ?? 0;
    try {
      buffered = audio.buffered.length > 0 ? audio.buffered.end(audio.buffered.length - 1) : 0;
    } catch {
      buffered = 0;
    }
  }

  async function startRename(event: MouseEvent): Promise<void> {
    if (!onrename) return;
    event.preventDefault();
    event.stopPropagation();
    draftName = name;
    editing = true;
    await tick();
    renameInput?.focus();
    renameInput?.select();
  }

  function commitRename(): void {
    if (!editing) return;
    const next = draftName.trim();
    editing = false;
    draftName = next || name;
    if (next && next !== name) onrename?.(next);
  }

  function handleRenameKeydown(event: KeyboardEvent): void {
    if (event.key === "Enter") {
      event.preventDefault();
      commitRename();
    } else if (event.key === "Escape") {
      event.preventDefault();
      editing = false;
      draftName = name;
    }
  }

  function handlePointerDown(event: PointerEvent): void {
    event.stopPropagation();
    if (!draggable || !recordingId || !sourceNoteId || editing || event.button !== 0) return;
    if (event.target instanceof Element && event.target.closest(".file-actions, .transport, input")) return;

    dragGesture = beginRecordingDrag(event);
    window.addEventListener("pointermove", handleWindowPointerMove, true);
    window.addEventListener("pointerup", handleWindowPointerUp, true);
    window.addEventListener("pointercancel", handleWindowPointerCancel, true);
    window.addEventListener("blur", cancelRecordingDrag, true);
  }

  function handleWindowPointerMove(event: PointerEvent): void {
    if (!dragGesture || event.pointerId !== dragGesture.pointerId) return;
    const next = moveRecordingDrag(dragGesture, event);
    dragGesture = next;
    if (!next.active) return;
    event.preventDefault();
    event.stopPropagation();
    updateDragGhost(event.clientX, event.clientY);
  }

  function handleWindowPointerUp(event: PointerEvent): void {
    const gesture = dragGesture;
    if (!gesture || event.pointerId !== gesture.pointerId) return;

    const boardTarget = document.elementFromPoint(event.clientX, event.clientY);
    const action = finishRecordingDrag(gesture, event, {
      overBoard: boardTarget?.closest(".board") !== null && boardTarget !== null,
      overNode: boardTarget?.closest("[data-note-id], [data-audio-node]") !== null && boardTarget !== null,
    });
    if (moveRecordingDrag(gesture, event).active) {
      event.preventDefault();
      event.stopPropagation();
    }
    if (action && sourceNoteId && recordingId) {
      dropAudioRecordingOnBoard(sourceNoteId, recordingId, event.clientX, event.clientY, action === "copy");
    }
    clearRecordingDrag();
  }

  function handleWindowPointerCancel(event: PointerEvent): void {
    if (dragGesture?.pointerId === event.pointerId) clearRecordingDrag();
  }

  function cancelRecordingDrag(): void {
    clearRecordingDrag();
  }

  function updateDragGhost(x: number, y: number): void {
    if (!dragGhostElement) {
      dragGhostElement = document.createElement("div");
      dragGhostElement.dataset.recordingDragGhost = "";
      dragGhostElement.setAttribute("aria-hidden", "true");
      dragGhostElement.textContent = name;
      dragGhostElement.style.cssText = "position:fixed;left:0;top:0;z-index:10000;max-width:240px;overflow:hidden;padding:5px 8px;border:1px solid #666;border-radius:4px;color:#eee;background:#252525;box-shadow:0 4px 14px #0008;font-size:11px;text-overflow:ellipsis;white-space:nowrap;pointer-events:none;user-select:none";
      document.body.append(dragGhostElement);
    }
    dragGhostElement.style.transform = `translate3d(${x + 12}px, ${y + 12}px, 0)`;
  }

  function clearRecordingDrag(): void {
    window.removeEventListener("pointermove", handleWindowPointerMove, true);
    window.removeEventListener("pointerup", handleWindowPointerUp, true);
    window.removeEventListener("pointercancel", handleWindowPointerCancel, true);
    window.removeEventListener("blur", cancelRecordingDrag, true);
    dragGesture = null;
    dragGhostElement?.remove();
    dragGhostElement = null;
  }

  onDestroy(clearRecordingDrag);

  function exportFile(): void {
    const extension = media.name?.split(".").at(-1) ?? media.file.split(".").at(-1) ?? "webm";
    const suggestedName = /\.[a-z0-9]{1,8}$/i.test(name) ? name : `${name}.${extension}`;
    void exportAttachmentAs(media, suggestedName);
  }

  function deleteRow(event: MouseEvent): void {
    event.stopPropagation();
    ondelete?.();
  }
</script>

<div
  class="audio-row"
  class:recording-row={draggable}
  data-audio-player-row
  data-recording-drag-source={draggable ? recordingId : undefined}
  data-selection-ignore
  role="group"
  aria-label={`${name} audio controls`}
  onpointerdown={handlePointerDown}
>
  <div class="file-heading">
    {#if editing}
      <input
        bind:this={renameInput}
        class="recording-name-input"
        bind:value={draftName}
        aria-label="Recording name"
        onkeydown={handleRenameKeydown}
        onblur={commitRename}
      />
    {:else if onrename}
      <button class="file-name editable" type="button" title="Double-click to rename" ondblclick={startRename}>{name}</button>
    {:else}
      <span class="file-name" title={name}>{name}</span>
    {/if}
    <div class="file-actions">
      <button class="icon-button" type="button" aria-label={`Export ${name}`} title="Export" onclick={exportFile}>
        <MediaIcon name="export" size={14} />
      </button>
      {#if ondelete}
        <button class="icon-button delete-button" type="button" aria-label={`Delete ${name}`} title="Delete" onclick={deleteRow}>
          <MediaIcon name="delete" size={14} />
        </button>
      {/if}
    </div>
  </div>

  <audio
    bind:this={audio}
    src={source}
    preload="metadata"
    onloadedmetadata={syncTime}
    ondurationchange={syncTime}
    ontimeupdate={syncTime}
    onprogress={syncTime}
    onplay={() => (playing = true)}
    onpause={() => (playing = false)}
    onended={() => (playing = false)}
    aria-label={`Audio player for ${name}`}
  ></audio>

  <div class="transport">
    <button class="play-button" type="button" aria-label={playing ? "Pause audio" : "Play audio"} title={playing ? "Pause" : "Play"} onclick={() => void togglePlayback()}>
      <MediaIcon name={playing ? "pause" : "play"} size={15} />
    </button>
    <MediaTime seconds={currentTime} />
    <MediaSlider
      value={currentTime}
      max={safeDuration}
      {buffered}
      step={0.1}
      label={`Seek ${name}`}
      tooltip={formatMediaTime}
      oninput={seek}
      onchange={seek}
    />
    <MediaTime seconds={safeDuration} />
    <div class="volume-wrap">
      <button class="icon-button volume-button" type="button" aria-label={muted || volume === 0 ? "Unmute audio" : "Mute audio"} title="Volume" onclick={toggleMute}>
        <MediaIcon name={muted || volume === 0 ? "mute" : "volume"} size={15} />
      </button>
      <div class="volume-popover" data-selection-ignore>
        <MediaSlider value={volume} max={1} step={0.01} label={`Volume ${name}`} oninput={changeVolume} onchange={changeVolume} />
      </div>
    </div>
  </div>
</div>

<style>
  .audio-row { display: flex; min-width: 0; flex-direction: column; gap: 4px; padding: 7px 8px; border: 1px solid #3e3e3e; border-radius: 4px; background: #2b2b2b; }
  .recording-row { cursor: grab; }
  .recording-row:active { cursor: grabbing; }
  .file-heading { display: flex; min-width: 0; align-items: center; gap: 8px; }
  .file-name { min-width: 0; overflow: hidden; color: #d8d8d8; font-size: 11px; font-weight: 550; text-overflow: ellipsis; white-space: nowrap; }
  button.file-name { padding: 0; border: 0; background: transparent; text-align: left; cursor: text; }
  .recording-name-input { min-width: 0; flex: 1; padding: 2px 4px; border: 1px solid #5c5137; border-radius: 3px; outline: none; color: #eee; background: #242424; font: inherit; font-size: 11px; }
  .file-actions { display: flex; flex: 0 0 auto; align-items: center; gap: 2px; margin-left: auto; }
  .icon-button, .play-button { display: grid; flex: 0 0 auto; place-items: center; padding: 0; border: 1px solid transparent; color: #e8e8e8; background: transparent; cursor: pointer; }
  .icon-button { width: 23px; height: 23px; border-radius: 3px; }
  .icon-button:hover, .icon-button:focus-visible { border-color: #4c4c4c; color: #fff; background: #383838; outline: none; }
  .delete-button:hover { color: #fff; }
  .transport { display: grid; min-width: 0; grid-template-columns: 26px auto minmax(28px, 1fr) auto 24px; align-items: center; gap: 5px; }
  .play-button { width: 25px; height: 25px; border-color: #4a4a4a; border-radius: 50%; color: #e8e8e8; background: #353535; }
  .play-button:hover { border-color: rgba(255, 255, 255, .45); background: #404040; }
  .volume-wrap { position: relative; display: grid; width: 24px; height: 24px; place-items: center; }
  .volume-popover { position: absolute; z-index: 5; right: 0; bottom: 100%; display: none; width: 118px; padding: 5px 7px; border: 1px solid #494949; border-radius: 4px; background: #222; box-shadow: 0 3px 9px #0006; }
  .volume-wrap:hover .volume-popover, .volume-wrap:focus-within .volume-popover { display: block; }
  audio { display: none; }
  @media (prefers-reduced-motion: reduce) { * { scroll-behavior: auto !important; } }
</style>
