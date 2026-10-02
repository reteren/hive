<script lang="ts">
  import { onMount } from "svelte";
  import { tierlistVideoFrame } from "./videoPreview";

  let { file, url, duration, name, lines }: {
    file: string;
    url: string;
    duration?: number;
    name: string;
    lines: string[];
  } = $props();
  let frame = $state<string | null>(null);

  $effect(() => {
    const request = tierlistVideoFrame(file, url, duration);
    let active = true;
    void request.then((result) => {
      if (active) frame = result;
    });
    return () => { active = false; };
  });
</script>

{#if frame}
  <img class="tier-card-image tier-video-frame" src={frame} alt={name} />
{:else}
  <div class="tier-video-fallback">
    <strong>{name}</strong>
    <span>{lines.join("\n") || "No text"}</span>
  </div>
{/if}

<style>
  .tier-video-frame { display: block; width: 100%; height: 54px; object-fit: contain; }
  .tier-video-fallback { display: flex; box-sizing: border-box; width: 100%; height: 56px; flex-direction: column; justify-content: center; gap: 2px; padding: 5px 16px 5px 7px; text-align: left; }
  .tier-video-fallback strong { overflow: hidden; color: #f0e4c9; font-size: 10px; text-overflow: ellipsis; white-space: nowrap; }
  .tier-video-fallback span { display: -webkit-box; overflow: hidden; color: #bfc1c6; font-size: 10px; line-height: 1.25; white-space: pre-line; line-clamp: 3; -webkit-box-orient: vertical; -webkit-line-clamp: 3; }
</style>
