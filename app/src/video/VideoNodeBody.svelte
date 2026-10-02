<script lang="ts">
  import { onDestroy, onMount } from "svelte";
  import { attachmentUrl } from "../attachments/service";
  import { registerHoverPlayback } from "../media-ui/hoverPlayback";
  import type { Note } from "../model/note";
  import NoteBody from "../editor/NoteBody.svelte";
  import { videoCaptureAction } from "./logic";
  import VideoControls from "./VideoControls.svelte";
  import { createControlsAutoHide } from "./controlsAutoHide";

  let { note }: { note: Note } = $props();
  let nodeElement = $state<HTMLElement | null>(null);
  let videoElement = $state<HTMLVideoElement | null>(null);
  let frameElement = $state<HTMLElement | null>(null);
  let failed = $state(false);
  let playing = $state(false);
  let currentTime = $state(0);
  let seekDraft = $state<number | null>(null);
  let duration = $state(0);
  let buffered = $state(0);
  let volume = $state(1);
  let muted = $state(false);
  let controlsVisible = $state(true);
  let captureGesture: { pointerId: number; start: { x: number; y: number }; moved: boolean } | null = null;
  let media = $derived(note.media?.kind === "video" ? note.media : null);
  let source = $derived(media ? attachmentUrl(media.file) : "");
  let displayTime = $derived(seekDraft ?? currentTime);
  let aspectWidth = $derived(media?.naturalWidth && media.naturalWidth > 0 ? media.naturalWidth : 16);
  let aspectHeight = $derived(media?.naturalHeight && media.naturalHeight > 0 ? media.naturalHeight : 9);

  const controlsAutoHide = createControlsAutoHide((visible) => { controlsVisible = visible; }, 500);

  $effect(() => {
    void source;
    failed = false;
    playing = false;
    currentTime = 0;
    seekDraft = null;
    duration = media?.duration ?? 0;
  });

  $effect(() => {
    controlsAutoHide.setPlaying(playing);
  });

  onMount(() => {
    const unregisterHoverPlayback = nodeElement ? registerHoverPlayback(nodeElement, togglePlayback) : undefined;
    window.addEventListener("pointermove", onCapturePointerMove, true);
    window.addEventListener("pointerup", onCapturePointerUp, true);
    window.addEventListener("pointercancel", onCapturePointerCancel, true);
    return () => {
      window.removeEventListener("pointermove", onCapturePointerMove, true);
      window.removeEventListener("pointerup", onCapturePointerUp, true);
      window.removeEventListener("pointercancel", onCapturePointerCancel, true);
      unregisterHoverPlayback?.();
      captureGesture = null;
    };
  });
  onDestroy(() => controlsAutoHide.dispose());

  function togglePlayback(): void {
    const video = videoElement;
    if (!video || failed) return;
    if (video.paused) void video.play().catch(() => { failed = true; });
    else video.pause();
  }

  function seekTo(value: number): void {
    const video = videoElement;
    if (!video) return;
    const next = Math.min(Math.max(0, value), Number.isFinite(video.duration) ? video.duration : value);
    seekDraft = null;
    currentTime = next;
    video.currentTime = next;
  }

  function previewSeek(value: number): void {
    seekDraft = value;
  }

  function updateTime(): void {
    const video = videoElement;
    if (!video) return;
    if (seekDraft === null) currentTime = video.currentTime;
    if (Number.isFinite(video.duration)) duration = video.duration;
    if (video.buffered.length > 0 && Number.isFinite(video.duration)) {
      buffered = Math.min(video.buffered.end(video.buffered.length - 1), video.duration);
    }
  }

  function syncVolume(): void {
    if (!videoElement) return;
    volume = videoElement.volume;
    muted = videoElement.muted;
  }

  function setVolume(value: number): void {
    if (!videoElement) return;
    videoElement.volume = Math.min(1, Math.max(0, value));
    if (videoElement.volume > 0 && videoElement.muted) videoElement.muted = false;
    syncVolume();
  }

  function toggleMute(): void {
    if (!videoElement) return;
    videoElement.muted = !videoElement.muted;
    syncVolume();
  }

  async function toggleFullscreen(): Promise<void> {
    const video = videoElement;
    if (!video) return;
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else await video.requestFullscreen();
    } catch {
      // Fullscreen can be unavailable in embedded webviews; playback remains usable.
    }
  }

  function onPointerActivity(): void {
    controlsAutoHide.pointerActivity();
  }

  function onVideoCapturePointerDown(event: PointerEvent): void {
    if (event.button !== 0 || event.isPrimary === false) return;
    captureGesture = {
      pointerId: event.pointerId,
      start: { x: event.clientX, y: event.clientY },
      moved: false,
    };
  }

  function onCapturePointerMove(event: PointerEvent): void {
    const gesture = captureGesture;
    if (!gesture || gesture.pointerId !== event.pointerId || gesture.moved) return;
    if (videoCaptureAction(gesture.start, { x: event.clientX, y: event.clientY }) === "move") {
      gesture.moved = true;
    }
  }

  function onCapturePointerUp(event: PointerEvent): void {
    const gesture = captureGesture;
    if (!gesture || gesture.pointerId !== event.pointerId) return;
    captureGesture = null;
    if (!gesture.moved) togglePlayback();
  }

  function onCapturePointerCancel(event: PointerEvent): void {
    if (captureGesture?.pointerId === event.pointerId) captureGesture = null;
  }

  function onVideoCaptureKeydown(event: KeyboardEvent): void {
    if (event.code !== "Enter" || event.repeat) return;
    event.preventDefault();
    togglePlayback();
  }

</script>

<section
  class="video-node-body"
  bind:this={nodeElement}
  data-video-node={note.id}
  data-frame-hidden={note.frameHidden === true ? "true" : undefined}
>
  {#if !source || failed}
    <div class="video-error" data-video-error role="status">{failed ? "Video could not be played." : `File missing: ${media?.name ?? note.name}`}</div>
  {:else}
    <div
      class="video-frame"
      bind:this={frameElement}
      data-video-frame
      role="group"
      aria-label="Video player"
      style={`aspect-ratio: ${aspectWidth} / ${aspectHeight};`}
      onpointermove={onPointerActivity}
      onpointerleave={controlsAutoHide.pointerLeave}
    >
      <!-- The stored media contract has no separate caption-track field; the editable node caption remains below. -->
      <!-- svelte-ignore a11y_media_has_caption -->
      <video
        bind:this={videoElement}
        class="video-player"
        data-video-player
        data-video-file={media?.file}
        src={source}
        preload="metadata"
        playsinline
        aria-label={`Video player for ${media?.name ?? note.name}`}
        data-selection-ignore
        onloadedmetadata={updateTime}
        ondurationchange={updateTime}
        ontimeupdate={updateTime}
        onprogress={updateTime}
        onplay={() => { playing = true; syncVolume(); }}
        onpause={() => { playing = false; }}
        onended={() => { playing = false; }}
        onvolumechange={syncVolume}
        onerror={() => { failed = true; }}
        onclick={(event) => { event.stopPropagation(); togglePlayback(); }}
      ></video>
      {#if note.frameHidden === true}
        <div
          class="video-capture"
          data-video-capture
          data-note-header
          role="button"
          tabindex="0"
          aria-label={`Play or pause ${media?.name ?? note.name}`}
          onpointerdown={onVideoCapturePointerDown}
          onkeydown={onVideoCaptureKeydown}
        ></div>
      {/if}
      <VideoControls
        playing={playing}
        visible={controlsVisible || !playing}
        currentTime={displayTime}
        {duration}
        {buffered}
        {volume}
        {muted}
        onTogglePlayback={togglePlayback}
        onSeekPreview={previewSeek}
        onSeek={seekTo}
        onVolume={setVolume}
        onToggleMute={toggleMute}
        onFullscreen={() => { void toggleFullscreen(); }}
      />
    </div>
  {/if}
  {#if note.frameHidden !== true}
    <div class="video-caption" data-video-caption>
      <NoteBody {note} />
    </div>
  {/if}
</section>

<style>
  .video-node-body { display: flex; min-width: 0; flex-direction: column; gap: 5px; }
  .video-frame { position: relative; width: 100%; overflow: hidden; background: #282828; }
  .video-player { position: absolute; inset: 0; display: block; width: 100%; height: 100%; object-fit: contain; background: #282828; }
  .video-capture { position: absolute; z-index: 1; inset: 0; background: transparent; cursor: grab; touch-action: none; }
  .video-capture:active { cursor: grabbing; }
  .video-error { display: grid; min-height: 72px; place-items: center; padding: 8px; color: #c3c3c3; background: #282828; font-size: 11px; overflow-wrap: anywhere; }
  .video-caption { min-width: 0; }
  :global(.note-card:has(.video-node-body[data-frame-hidden="true"])) { border: 0; border-radius: 0; background: transparent; box-shadow: none; }
  :global(.note-card:has(.video-node-body[data-frame-hidden="true"]) > .hidden-note-header) { display: none; }
  :global(.note-card:has(.video-node-body[data-frame-hidden="true"]) > .note-frame) { display: block; min-height: 0; flex: 1 1 auto; background: transparent; }
  :global(.note-card:has(.video-node-body[data-frame-hidden="true"]) .note-frame-edge) { display: none; }
  :global(.note-card:has(.video-node-body[data-frame-hidden="true"]) .note-content) { min-height: 0; padding: 0; background: transparent; }
</style>
