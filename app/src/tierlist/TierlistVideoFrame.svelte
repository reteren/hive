<script lang="ts">
  import { onMount } from "svelte";
  import { tierlistVideoFrame } from "./videoPreview";
  import { t } from "../i18n/i18n.svelte";

  let { file, url, name, lines }: {
    file: string;
    url: string;
    name: string;
    lines: string[];
  } = $props();
  let root = $state<HTMLDivElement | null>(null);
  let canvas = $state<HTMLCanvasElement | null>(null);
  let ready = $state(false);
  let nearViewport = $state(false);

  onMount(() => {
    if (!root || !("IntersectionObserver" in window)) { nearViewport = true; return; }
    const observer = new IntersectionObserver(([entry]) => { nearViewport = Boolean(entry?.isIntersecting); }, { rootMargin: "240px" });
    observer.observe(root);
    return () => observer.disconnect();
  });

  $effect(() => {
    const target = canvas;
    if (!target || !nearViewport) return;
    const lease = tierlistVideoFrame(file, url);
    let active = true;
    void lease.promise.then((result) => {
      if (active && result) {
        target.width = result.width;
        target.height = result.height;
        target.getContext("2d")?.drawImage(result, 0, 0);
        ready = true;
      }
      lease.release();
    });
    return () => { active = false; lease.release(); };
  });
</script>

<div class="tier-video-preview" bind:this={root}>
  <canvas bind:this={canvas} class="tier-card-image tier-video-frame" aria-label={name} title={name} hidden={!ready}></canvas>
  {#if !ready}
    <div class="tier-video-fallback">
      <strong>{name}</strong>
      <span>{lines.join("\n") || t("No text")}</span>
    </div>
  {/if}
</div>

<style>
  .tier-video-preview { width: 100%; height: 54px; }
  .tier-video-frame { display: block; width: 100%; height: 54px; object-fit: contain; }
  .tier-video-frame[hidden] { display: none; }
  .tier-video-fallback { display: flex; box-sizing: border-box; width: 100%; height: 56px; flex-direction: column; justify-content: center; gap: 2px; padding: 5px 16px 5px 7px; text-align: left; }
  .tier-video-fallback strong { overflow: hidden; color: #f0e4c9; font-size: 10px; text-overflow: ellipsis; white-space: nowrap; }
  .tier-video-fallback span { display: -webkit-box; overflow: hidden; color: #bfc1c6; font-size: 10px; line-height: 1.25; white-space: pre-line; line-clamp: 3; -webkit-box-orient: vertical; -webkit-line-clamp: 3; }
</style>
