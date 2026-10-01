<script lang="ts">
  import type { Note } from "../model/note";
  import { attachmentUrl } from "../attachments/service";
  import NoteBody from "../editor/NoteBody.svelte";
  import { audioRecording, cancelAudioRecording, stopAudioRecording } from "./recording.svelte";

  let { note }: { note: Note } = $props();
  let player = $state<HTMLAudioElement | null>(null);
  let playing = $state(false);
  let currentTime = $state(0);
  let duration = $state(0);
  let volume = $state(1);
  let source = $derived(note.media ? attachmentUrl(note.media.file) : "");
  let isRecording = $derived(audioRecording.noteId === note.id &&
    (audioRecording.phase === "requesting" || audioRecording.phase === "recording" || audioRecording.phase === "saving"));
  let isSavedRecording = $derived(audioRecording.noteId === note.id && audioRecording.phase === "ready");

  async function togglePlayback(): Promise<void> {
    if (!player) return;
    if (player.paused) {
      try {
        await player.play();
      } catch {
        playing = false;
      }
    } else {
      player.pause();
    }
  }

  function seek(event: Event): void {
    if (!(event.currentTarget instanceof HTMLInputElement) || !player) return;
    player.currentTime = event.currentTarget.valueAsNumber;
    currentTime = player.currentTime;
  }

  function changeVolume(event: Event): void {
    if (!(event.currentTarget instanceof HTMLInputElement) || !player) return;
    volume = event.currentTarget.valueAsNumber;
    player.volume = volume;
  }

  function syncTime(): void {
    if (!player) return;
    currentTime = player.currentTime;
    if (Number.isFinite(player.duration)) duration = player.duration;
    else duration = note.media?.duration ?? 0;
  }

  function formatTime(value: number): string {
    const seconds = Math.max(0, Math.floor(Number.isFinite(value) ? value : 0));
    const minutes = Math.floor(seconds / 60);
    const remainder = seconds % 60;
    const hours = Math.floor(minutes / 60);
    return hours > 0
      ? `${hours}:${String(minutes % 60).padStart(2, "0")}:${String(remainder).padStart(2, "0")}`
      : `${minutes}:${String(remainder).padStart(2, "0")}`;
  }
</script>

<div class="audio-node" data-audio-node>
  {#if isRecording}
    <div class="recording-panel" data-audio-recording role="status" aria-live="polite">
      <div class="recording-title">
        <span class="recording-dot" aria-hidden="true"></span>
        <span>{audioRecording.phase === "requesting" ? "Requesting microphone…" : audioRecording.phase === "saving" ? "Saving…" : "Recording…"}</span>
        {#if audioRecording.phase === "recording"}<time>{formatTime(audioRecording.elapsedSeconds)}</time>{/if}
      </div>
      {#if audioRecording.phase === "recording"}
        <div class="level-track" role="meter" aria-label="Microphone level" aria-valuemin="0" aria-valuemax="100" aria-valuenow={Math.round(audioRecording.level * 100)}>
          <span style:width={`${Math.round(audioRecording.level * 100)}%`}></span>
        </div>
      {/if}
      <div class="recording-actions">
        {#if audioRecording.phase === "recording"}
          <button type="button" class="stop-button" data-selection-ignore onclick={stopAudioRecording}>Stop and save</button>
        {/if}
        {#if audioRecording.phase === "requesting" || audioRecording.phase === "recording"}
          <button type="button" data-selection-ignore onclick={cancelAudioRecording}>Cancel</button>
        {/if}
      </div>
    </div>
  {:else if note.media?.kind === "audio" && source}
    <div class="audio-player" data-audio-player data-selection-ignore>
      <audio
        bind:this={player}
        src={source}
        preload="metadata"
        onloadedmetadata={syncTime}
        ontimeupdate={syncTime}
        onplay={() => (playing = true)}
        onpause={() => (playing = false)}
        onended={() => (playing = false)}
        aria-label={`Audio player for ${note.name}`}
      ></audio>
      <div class="transport">
        <button type="button" class="play-button" aria-label={playing ? "Pause audio" : "Play audio"} data-selection-ignore onclick={() => void togglePlayback()}>
          {#if playing}
            <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M5 3.5h2v9H5zM9 3.5h2v9H9z" /></svg>
          {:else}
            <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M5 3.2 12 8l-7 4.8z" /></svg>
          {/if}
        </button>
        <span class="timecode">{formatTime(currentTime)}</span>
        <input
          class="seek-control"
          type="range"
          min="0"
          max={Math.max(duration, 0.1)}
          step="0.1"
          value={Math.min(currentTime, duration)}
          aria-label="Seek audio"
          oninput={seek}
        />
        <span class="timecode">{formatTime(duration)}</span>
      </div>
      <label class="volume-control">
        <span>Volume</span>
        <input type="range" min="0" max="1" step="0.01" value={volume} aria-label="Volume" oninput={changeVolume} />
      </label>
      {#if isSavedRecording}<div class="saved-status" role="status">Stopped — saved</div>{/if}
    </div>
  {:else}
    <div class="audio-error" role="status">Audio file is missing or unavailable.</div>
  {/if}

  <div class="audio-caption"><NoteBody {note} /></div>
</div>

<style>
  .audio-node { display: flex; min-width: 0; flex-direction: column; gap: 8px; }
  .audio-player, .recording-panel { display: flex; min-width: 0; flex-direction: column; gap: 8px; padding: 9px; border: 1px solid #494949; border-radius: 4px; background: #222; }
  .transport { display: grid; min-width: 0; grid-template-columns: 28px auto minmax(24px, 1fr) auto; align-items: center; gap: 7px; }
  .play-button { display: grid; width: 28px; height: 28px; place-items: center; padding: 0; border: 1px solid #555; border-radius: 50%; color: var(--text); background: #343434; cursor: pointer; }
  .play-button svg { width: 15px; height: 15px; fill: currentColor; }
  .timecode { color: #bcbcbc; font-size: 10px; font-variant-numeric: tabular-nums; white-space: nowrap; }
  .seek-control, .volume-control input { min-width: 0; width: 100%; accent-color: #d85045; }
  .volume-control { display: grid; grid-template-columns: 44px minmax(0, 1fr); align-items: center; gap: 8px; color: #aaa; font-size: 10px; }
  .saved-status { color: #a7d4a4; font-size: 10px; }
  .recording-title { display: flex; align-items: center; gap: 7px; color: #f1d4d1; font-size: 12px; }
  .recording-title time { margin-left: auto; font-variant-numeric: tabular-nums; }
  .recording-dot { width: 9px; height: 9px; border-radius: 50%; background: #e24136; box-shadow: 0 0 0 4px #e2413624; }
  .level-track { height: 8px; overflow: hidden; border-radius: 999px; background: #393939; }
  .level-track span { display: block; height: 100%; border-radius: inherit; background: linear-gradient(90deg, #57bb73, #e7c94c 76%, #df5a49); transition: width 80ms linear; }
  .recording-actions { display: flex; justify-content: flex-end; gap: 6px; }
  .recording-actions button { min-height: 26px; padding: 3px 9px; border: 1px solid #555; border-radius: 3px; color: var(--text); background: #343434; cursor: pointer; }
  .recording-actions .stop-button { min-width: 132px; min-height: 34px; border-color: #e05a50; background: #a9362e; font-size: 12px; font-weight: 700; }
  .audio-error { padding: 8px; color: #e1aaa6; font-size: 11px; }
  .audio-caption { min-width: 0; }
</style>
