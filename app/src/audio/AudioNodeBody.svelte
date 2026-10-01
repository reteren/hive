<script lang="ts">
  import { onMount } from "svelte";
  import type { Note } from "../model/note";
  import NoteBody from "../editor/NoteBody.svelte";
  import { registerHoverPlayback } from "../media-ui/hoverPlayback";
  import { MediaIcon, MediaTime } from "../media-ui";
  import AudioPlayerRow from "./AudioPlayerRow.svelte";
  import {
    audioRecording,
    beginAudioRecording,
    deleteAudioRecording,
    registerAudioRecordingDropHandler,
    renameAudioRecording,
    stopAudioRecording,
  } from "./recording.svelte";

  let { note }: { note: Note } = $props();
  let root = $state<HTMLDivElement | null>(null);
  let hoveredPlayer: HTMLAudioElement | null = null;
  let isDictaphone = $derived(Array.isArray(note.recordings));
  let isCurrentCapture = $derived(audioRecording.noteId === note.id);
  let phase = $derived(isCurrentCapture ? audioRecording.phase : "idle");
  let isRecording = $derived(phase === "recording");
  let isBusy = $derived(phase === "requesting" || phase === "saving");
  let isActiveElsewhere = $derived(audioRecording.noteId !== null && audioRecording.noteId !== note.id &&
    (audioRecording.phase === "requesting" || audioRecording.phase === "recording" || audioRecording.phase === "saving"));

  onMount(() => {
    if (!root) return;
    const unregisterHover = registerHoverPlayback(root, toggleHoveredPlayback);
    const unregisterDrop = isDictaphone ? registerAudioRecordingDropHandler() : () => undefined;
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
    <section class="dictaphone" aria-label="Audio recorder">
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
    </section>

    {#if (note.recordings?.length ?? 0) > 0}
      <section class="recording-list" aria-label="Recordings">
        {#each note.recordings ?? [] as recording (recording.id)}
          <AudioPlayerRow
            recordingId={recording.id}
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
  .dictaphone { display: grid; grid-template-columns: minmax(0, 1fr) 56px; align-items: center; gap: 12px; min-height: 94px; padding: 11px; border: 1px solid #414141; border-radius: 4px; background: #282828; }
  .recorder-display { display: flex; min-width: 0; flex-direction: column; gap: 9px; }
  .level-wave { display: flex; height: 42px; align-items: center; justify-content: space-between; gap: 2px; overflow: hidden; }
  .level-wave span { display: block; width: 2px; min-width: 1px; max-height: 100%; border-radius: 2px; background: #6d6d6d; transition: height 90ms linear, background-color 100ms ease; }
  .level-wave.active span { background: linear-gradient(to top, #c63831, #f26c57); }
  .recorder-status { display: flex; align-items: center; gap: 8px; }
  .status-label { color: #929292; font-size: 11px; }
  .recording-label { color: #e89188; }
  .record-button { display: grid; width: 52px; height: 52px; place-items: center; padding: 0; border: 1px solid #ef6559; border-radius: 50%; color: white; background: #c83e35; box-shadow: inset 0 0 0 4px #d7564b, 0 2px 8px #0005; cursor: pointer; transition: border-radius 140ms ease, transform 140ms ease, background-color 140ms ease; }
  .record-button:hover:not(:disabled) { transform: scale(1.04); background: #dc4b40; }
  .record-button.stop { border-radius: 9px; background: #a9362e; box-shadow: inset 0 0 0 3px #c24b42; }
  .record-button:disabled { opacity: 0.56; cursor: wait; }
  .recorder-error { grid-column: 1 / -1; margin: 0; color: #e8a39d; font-size: 11px; }
  .recording-list { display: flex; flex-direction: column; gap: 5px; }
  .empty-recordings { margin: 0; color: #888; font-size: 10px; text-align: center; }
  .audio-error { padding: 8px; color: #e1aaa6; font-size: 11px; }
  .audio-caption { min-width: 0; }
  :global(html[data-reduce-motion="true"]) .record-button,
  :global(html[data-reduce-motion="true"]) .level-wave span { transition: none; }
  @media (prefers-reduced-motion: reduce) { .record-button, .level-wave span { transition: none; } }
</style>
