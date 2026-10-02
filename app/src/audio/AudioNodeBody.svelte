<script lang="ts">
  import { onMount } from "svelte";
  import { worldToScreen } from "../board/cameraMath";
  import { camera as boardCamera, viewport as boardViewport } from "../board/camera.svelte";
  import { board } from "../model/board.svelte";
  import type { Note } from "../model/note";
  import NoteBody from "../editor/NoteBody.svelte";
  import { registerHoverPlayback } from "../media-ui/hoverPlayback";
  import { MediaIcon, MediaTime } from "../media-ui";
  import { activeDropTarget, registerDropTarget } from "../selection/dropTargets";
  import AudioPlayerRow from "./AudioPlayerRow.svelte";
  import { canDropAudioNodeOnDictaphone } from "./recordingLogic";
  import {
    audioRecording,
    beginAudioRecording,
    createDictaphoneAudioDropCommand,
    deleteAudioRecording,
    renameAudioRecording,
    stopAudioRecording,
  } from "./recording.svelte";

  let { note }: { note: Note } = $props();
  let root = $state<HTMLDivElement | null>(null);
  let hoveredPlayer: HTMLAudioElement | null = null;
  let isDictaphone = $derived(Array.isArray(note.recordings));
  let dropOwnerId = $derived(`audio-dictaphone:${note.id}`);
  let isAudioDropTarget = $derived($activeDropTarget?.ownerId === dropOwnerId);
  let isCurrentCapture = $derived(audioRecording.noteId === note.id);
  let phase = $derived(isCurrentCapture ? audioRecording.phase : "idle");
  let isRecording = $derived(phase === "recording");
  let isBusy = $derived(phase === "requesting" || phase === "saving");
  let isActiveElsewhere = $derived(audioRecording.noteId !== null && audioRecording.noteId !== note.id &&
    (audioRecording.phase === "requesting" || audioRecording.phase === "recording" || audioRecording.phase === "saving"));

  onMount(() => {
    if (!root) return;
    const unregisterHover = registerHoverPlayback(root, toggleHoveredPlayback);
    const unregisterDrop = isDictaphone ? registerDropTarget({
      ownerId: dropOwnerId,
      accepts(noteIds, worldPoint) {
        if (noteIds.length !== 1 || !root || !canDropAudioNodeOnDictaphone(board.notes[noteIds[0]], note)) return null;
        const host = root.closest<HTMLElement>(".note-card[data-note-id]");
        const boardElement = document.querySelector<HTMLElement>(".board");
        if (!host || !boardElement) return null;
        const boardBounds = boardElement.getBoundingClientRect();
        const screen = worldToScreen(boardCamera, boardViewport, worldPoint);
        const clientX = boardBounds.left + screen.x;
        const clientY = boardBounds.top + screen.y;
        const bounds = host.getBoundingClientRect();
        if (clientX < bounds.left || clientX > bounds.right || clientY < bounds.top || clientY > bounds.bottom) return null;
        return { ownerId: dropOwnerId, targetId: note.id, payload: { sourceId: noteIds[0] } };
      },
      drop(noteIds, _match, modifiers) {
        const sourceId = noteIds[0];
        const originalPosition = modifiers?.originalPositions?.find((position) => position.id === sourceId);
        return sourceId
          ? createDictaphoneAudioDropCommand(sourceId, note.id, modifiers?.ctrlKey ?? false, originalPosition)
          : null;
      },
    }) : () => undefined;
    return () => {
      unregisterHover();
      unregisterDrop();
    };
  });

  function toggleHoveredPlayback(): void {
    if (!root) return;
    const players = Array.from(root.querySelectorAll<HTMLAudioElement>("audio"));
    const active = players.find((player) => !player.paused) ?? hoveredPlayer ?? players[0];
    if (!active) return;
    if (active.paused) void active.play().catch(() => undefined);
    else active.pause();
  }

  function trackHoveredPlayer(event: PointerEvent): void {
    if (!(event.target instanceof Element)) return;
    hoveredPlayer = event.target.closest("[data-audio-player-row]")?.querySelector("audio") ?? null;
  }

  function toggleRecording(): void {
    if (isRecording) stopAudioRecording(note.id);
    else if (!isBusy && !isActiveElsewhere) beginAudioRecording(note.id);
  }

  function renameRecording(recordingId: string, name: string): void {
    renameAudioRecording(note.id, recordingId, name);
  }

  function deleteRecording(recordingId: string): void {
    deleteAudioRecording(note.id, recordingId);
  }
</script>

<div class="audio-node" bind:this={root} data-audio-node={note.id} role="group" aria-label={`${note.name} audio node`} onpointermove={trackHoveredPlayer} onpointerleave={() => (hoveredPlayer = null)} ondblclick={(event) => event.stopPropagation()}>
  {#if isDictaphone}
    <section
      class="dictaphone"
      class:drop-target={isAudioDropTarget}
      data-audio-dictaphone-drop-target={isAudioDropTarget ? note.id : undefined}
      aria-label="Audio recorder"
    >
      <div class="recorder-display" class:is-recording={isRecording} data-audio-recording={note.id}>
        <div class="level-wave" class:active={isRecording} role="meter" aria-label="Microphone level" aria-valuemin="0" aria-valuemax="100" aria-valuenow={isRecording ? Math.round(audioRecording.level * 100) : 0}>
          {#each Array.from({ length: 36 }, (_, index) => index) as index (index)}
            {@const height = isRecording
              ? Math.max(6, Math.round((0.1 + audioRecording.level * (0.2 + Math.abs(Math.sin(index * 1.7)) * 0.8)) * 100))
              : 6 + Math.round(Math.abs(Math.sin(index * 0.58)) * 8)}
            <span style:height={`${height}%`}></span>
          {/each}
        </div>
        <div class="recorder-status">
          <span class="status-label" class:recording-label={isRecording}>
            {#if phase === "requesting"}Connecting to microphone
            {:else if phase === "recording"}Recording
            {:else if phase === "saving"}Saving recording
            {:else if phase === "error" && isCurrentCapture}Recording stopped
            {:else}Ready to record{/if}
          </span>
          <MediaTime seconds={audioRecording.noteId === note.id ? audioRecording.elapsedSeconds : 0} />
        </div>
      </div>

      <button
        class="record-button"
        class:stop={isRecording}
        type="button"
        aria-label={isRecording ? "Stop and save recording" : "Start recording"}
        aria-pressed={isRecording}
        title={isRecording ? "Stop and save" : "Record"}
        disabled={isBusy || isActiveElsewhere}
        data-selection-ignore
        onclick={toggleRecording}
      >
        <MediaIcon name={isRecording ? "stop" : "record"} size={isRecording ? 22 : 27} />
      </button>

      {#if phase === "error" && isCurrentCapture && audioRecording.error}
        <p class="recorder-error" role="alert">{audioRecording.error}</p>
      {/if}
      {#if isAudioDropTarget}
        <div class="dictaphone-drop-hint" data-audio-dictaphone-drop-hint role="status">Drop to add recording</div>
      {/if}
    </section>

    {#if (note.recordings?.length ?? 0) > 0}
      <section class="recording-list" aria-label="Recordings">
        {#each note.recordings ?? [] as recording (recording.id)}
          <AudioPlayerRow
            recordingId={recording.id}
            sourceNoteId={note.id}
            media={recording.media}
            name={recording.name}
            draggable
            onrename={(name) => renameRecording(recording.id, name)}
            ondelete={() => deleteRecording(recording.id)}
          />
        {/each}
      </section>
    {:else}
      <p class="empty-recordings">Your recordings will appear here.</p>
    {/if}
  {:else if note.media?.kind === "audio"}
    <AudioPlayerRow media={note.media} name={note.name} />
  {:else}
    <div class="audio-error" role="status">Audio file is missing or unavailable.</div>
  {/if}

  {#if note.text.trim()}
    <div class="audio-caption"><NoteBody {note} /></div>
  {/if}
</div>

<style>
  .audio-node { display: flex; min-width: 0; flex-direction: column; gap: 8px; color: #d8d8d8; }
  .dictaphone { display: grid; grid-template-columns: minmax(0, 1fr) 56px; align-items: center; gap: 12px; min-height: 94px; padding: 11px; border: 1px solid #414141; border-radius: 4px; background: #282828; user-select: none; }
  .dictaphone.drop-target { outline: 2px solid var(--accent); outline-offset: 2px; }
  .dictaphone-drop-hint { grid-column: 1 / -1; justify-self: center; color: var(--accent); font-size: 11px; font-weight: 600; }
  .recorder-display { display: flex; min-width: 0; flex-direction: column; gap: 9px; }
  .level-wave { display: flex; height: 42px; align-items: center; justify-content: space-between; gap: 2px; overflow: hidden; }
  .level-wave span { display: block; width: 2px; min-width: 1px; max-height: 100%; border-radius: 2px; background: rgba(255, 255, 255, .85); transition: height 90ms linear, background-color 100ms ease; }
  .recorder-status { display: flex; align-items: center; gap: 8px; }
  .status-label { color: #929292; font-size: 11px; }
  .recording-label { color: #fff; }
  .record-button { display: grid; width: 52px; height: 52px; place-items: center; padding: 0; border: 1px solid #ef6559; border-radius: 50%; color: white; background: #c83e35; box-shadow: inset 0 0 0 4px #d7564b, 0 2px 8px #0005; cursor: pointer; transition: border-radius 140ms ease, transform 140ms ease, background-color 140ms ease; }
  .record-button:hover:not(:disabled) { transform: scale(1.04); background: #dc4b40; }
  .record-button.stop { border-radius: 9px; background: #a9362e; box-shadow: inset 0 0 0 3px #c24b42; }
  .record-button:disabled { opacity: 0.56; cursor: wait; }
  .recorder-error { grid-column: 1 / -1; margin: 0; color: #e8a39d; font-size: 11px; }
  .recording-list { display: flex; flex-direction: column; gap: 5px; user-select: none; }
  .recording-list :global(.recording-name-input) { user-select: text; }
  .empty-recordings { margin: 0; color: #888; font-size: 10px; text-align: center; user-select: none; }
  .audio-error { padding: 8px; color: #e1aaa6; font-size: 11px; }
  .audio-caption { min-width: 0; }
  :global(html[data-reduce-motion="true"]) .record-button,
  :global(html[data-reduce-motion="true"]) .level-wave span { transition: none; }
  @media (prefers-reduced-motion: reduce) { .record-button, .level-wave span { transition: none; } }
</style>
