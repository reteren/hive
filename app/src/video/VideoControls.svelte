<script lang="ts">
  import MediaSlider from "../media-ui/MediaSlider.svelte";
  import MediaTime from "../media-ui/MediaTime.svelte";
  import MediaIcon from "../media-ui/MediaIcon.svelte";

  interface Props {
    playing: boolean;
    visible: boolean;
    currentTime: number;
    duration: number;
    buffered?: number;
    volume: number;
    muted: boolean;
    onTogglePlayback: () => void;
    onSeekPreview: (value: number) => void;
    onSeek: (value: number) => void;
    onVolume: (value: number) => void;
    onToggleMute: () => void;
    onFullscreen: () => void;
  }

  let {
    playing, visible, currentTime, duration, buffered = 0, volume, muted,
    onTogglePlayback, onSeekPreview, onSeek, onVolume, onToggleMute, onFullscreen,
  }: Props = $props();

  function formatTooltip(seconds: number): string {
    const safe = Math.max(0, Math.floor(Number.isFinite(seconds) ? seconds : 0));
    const hours = Math.floor(safe / 3600);
    const minutes = Math.floor((safe % 3600) / 60);
    const remainder = safe % 60;
    return hours > 0
      ? `${hours}:${String(minutes).padStart(2, "0")}:${String(remainder).padStart(2, "0")}`
      : `${minutes}:${String(remainder).padStart(2, "0")}`;
  }
</script>

<div class="player-controls" class:visible data-video-controls data-selection-ignore>
  <button class="player-button" type="button" aria-label={playing ? "Pause video" : "Play video"} onclick={onTogglePlayback}>
    <MediaIcon name={playing ? "pause" : "play"} size={15} />
  </button>
  <MediaTime seconds={currentTime} />
  <MediaSlider
    value={currentTime}
    max={duration}
    buffered={buffered}
    step={0.1}
    label="Seek video"
    tooltip={formatTooltip}
    oninput={onSeekPreview}
    onchange={onSeek}
  />
  <MediaTime seconds={duration} />
  <div class="volume-control">
    <button class="player-button" type="button" aria-label={muted ? "Unmute video" : "Mute video"} onclick={onToggleMute}>
      <MediaIcon name={muted || volume === 0 ? "mute" : "volume"} size={15} />
    </button>
    <div class="volume-slider" data-video-volume>
      <MediaSlider value={volume} max={1} step={0.01} label="Video volume" onchange={onVolume} />
    </div>
  </div>
  <button class="player-button" type="button" aria-label="Fullscreen" onclick={onFullscreen}>
    <MediaIcon name="fullscreen" size={15} />
  </button>
</div>

<style>
  .player-controls { display: flex; position: absolute; z-index: 2; right: 0; bottom: 0; left: 0; min-height: 34px; align-items: center; gap: 6px; padding: 5px 7px; opacity: 0; background: linear-gradient(transparent, rgb(15 15 15 / 88%)); transition: opacity 120ms ease; pointer-events: none; }
  .player-controls.visible { opacity: 1; pointer-events: auto; }
  .player-controls :global(.media-time) { flex: 0 0 auto; color: #dedede; }
  .player-controls :global(.media-slider) { flex: 1 1 auto; min-width: 40px; }
  .player-button { display: grid; width: 25px; height: 25px; flex: 0 0 auto; place-items: center; padding: 0; border: 1px solid transparent; border-radius: 3px; color: #e2e2e2; background: transparent; cursor: pointer; }
  .player-button:hover, .player-button:focus-visible { border-color: #5a5a5a; color: #fff1c0; background: #363636; outline: none; }
  .volume-control { position: relative; display: flex; align-items: center; }
  .volume-slider { display: none; position: absolute; z-index: 3; right: 50%; bottom: calc(100% + 3px); width: 74px; padding: 5px 7px; transform: translateX(50%); border: 1px solid #4a4a4a; border-radius: 3px; background: #282828; }
  .volume-control:hover .volume-slider, .volume-control:focus-within .volume-slider { display: block; }
  :global(html[data-reduce-motion="true"]) .player-controls { transition: none; }
</style>
