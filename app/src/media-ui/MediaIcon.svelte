<script lang="ts">
  import DeleteIcon from "./icons/DeleteIcon.svelte";
  import ExportIcon from "./icons/ExportIcon.svelte";
  import FullscreenIcon from "./icons/FullscreenIcon.svelte";
  import MuteIcon from "./icons/MuteIcon.svelte";
  import PauseIcon from "./icons/PauseIcon.svelte";
  import PlayIcon from "./icons/PlayIcon.svelte";
  import RecordIcon from "./icons/RecordIcon.svelte";
  import StopIcon from "./icons/StopIcon.svelte";
  import VolumeIcon from "./icons/VolumeIcon.svelte";

  type MediaIconName = "play" | "pause" | "volume" | "mute" | "record" | "stop" | "export" | "delete" | "fullscreen";
  let { name, size = 16 }: { name: MediaIconName; size?: number } = $props();
</script>

<span class="media-icon" aria-hidden="true">
  {#if name === "play"}
    <PlayIcon {size} />
  {:else if name === "pause"}
    <PauseIcon {size} />
  {:else if name === "volume"}
    <VolumeIcon {size} />
  {:else if name === "mute"}
    <MuteIcon {size} />
  {:else if name === "record"}
    <RecordIcon {size} />
  {:else if name === "stop"}
    <StopIcon {size} />
  {:else if name === "export"}
    <ExportIcon {size} />
  {:else if name === "delete"}
    <DeleteIcon {size} />
  {:else}
    <FullscreenIcon {size} />
  {/if}
</span>

<style>
  .media-icon { display: inline-flex; flex: 0 0 auto; align-items: center; justify-content: center; color: inherit; user-select: none; -webkit-user-select: none; }
</style>
