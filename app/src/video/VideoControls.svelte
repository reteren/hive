<script lang="ts">
  import { onDestroy } from "svelte";
  import MediaSlider from "../media-ui/MediaSlider.svelte";
  import MediaTime from "../media-ui/MediaTime.svelte";
  import MediaIcon from "../media-ui/MediaIcon.svelte";
  import { createHoverIntent } from "./hoverIntent";
  import { VIDEO_VOLUME_POPOVER } from "./volumePopover";

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
  let volumeOpen = $state(false);
  const volumeIntent = createHoverIntent((open) => { volumeOpen = open; }, 250);

  onDestroy(() => volumeIntent.dispose());

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
  <div
    class="volume-control"
    class:open={volumeOpen}
    role="group"
    aria-label="Video volume controls"
    data-volume-open={volumeOpen ? "true" : undefined}
    onpointerenter={volumeIntent.pointerEnter}
    onpointerleave={volumeIntent.pointerLeave}
    onfocusin={volumeIntent.focus}
    onfocusout={(event) => {
      const root = event.currentTarget;
      if (root instanceof HTMLElement && event.relatedTarget instanceof Node && root.contains(event.relatedTarget)) return;
      volumeIntent.blur();
    }}
  >
    <button class="player-button" type="button" aria-label={muted ? "Unmute video" : "Mute video"} aria-expanded={volumeOpen} onclick={onToggleMute}>
      <MediaIcon name={muted || volume === 0 ? "mute" : "volume"} size={15} />
    </button>
    <div
      class="volume-slider"
      data-video-volume
      style={`--volume-popover-width: ${VIDEO_VOLUME_POPOVER.width}px; --volume-popover-height: ${VIDEO_VOLUME_POPOVER.height}px;`}
    >
      <MediaSlider value={volume} max={1} step={0.01} label="Video volume" orientation="vertical" oninput={onVolume} onchange={onVolume} />
    </div>
  </div>
  <button class="player-button" type="button" aria-label="Fullscreen" onclick={onFullscreen}>
    <MediaIcon name="fullscreen" size={15} />
  </button>
</div>

<style>
  .player-controls { display: flex; position: absolute; z-index: 2; right: 0; bottom: 0; left: 0; min-height: 34px; align-items: center; gap: 6px; padding: 5px 7px; opacity: 0; background: linear-gradient(transparent, rgb(15 15 15 / 88%)); transition: opacity 120ms ease; pointer-events: none; user-select: none; -webkit-user-select: none; }
  .player-controls.visible { opacity: 1; pointer-events: auto; }
  .player-controls :global(.media-time) { flex: 0 0 auto; color: #e8e8e8; }
  .player-controls :global(.media-slider) { flex: 1 1 auto; min-width: 40px; }
  .player-button { display: grid; width: 25px; height: 25px; flex: 0 0 auto; place-items: center; padding: 0; border: 1px solid transparent; border-radius: 3px; color: #e8e8e8; background: transparent; cursor: pointer; }
  .player-button:hover { border-color: rgba(255, 255, 255, .35); color: #fff; background: #363636; }
  .player-button:active { border-color: rgba(255, 255, 255, .35); color: #fff; background: #363636; }
  .player-button:focus-visible { border-color: rgba(255, 255, 255, .35); color: #fff; background: #363636; outline: 2px solid var(--accent); outline-offset: 1px; }
  .volume-control { position: relative; display: flex; align-items: center; }
  .volume-slider { display: none; position: absolute; z-index: 3; right: 50%; bottom: calc(100% - 4px); box-sizing: border-box; width: var(--volume-popover-width); height: var(--volume-popover-height); padding: 6px; transform: translateX(50%); border: 1px solid #4a4a4a; border-radius: 6px; background: #363636; box-shadow: 0 3px 10px rgb(0 0 0 / 32%); }
  .volume-slider :global(.media-slider) { width: 16px; min-width: 16px; height: 100%; flex: 0 0 auto; }
  .volume-control.open .volume-slider { display: flex; align-items: center; justify-content: center; }
  :global(html[data-reduce-motion="true"]) .player-controls { transition: none; }
</style>
