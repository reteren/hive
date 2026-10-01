<script lang="ts">
  import { onMount } from "svelte";
  import type { ImageRef } from "./types";
  import { attachmentUrl } from "./service";
  import { gifPlayback, isGifStopped, shouldPlayGif, type GifPlaybackTarget } from "./gifPlayback.svelte";

  interface Props {
    image: ImageRef;
    target: GifPlaybackTarget;
    hostSelected?: boolean;
    hoverWhenSelected?: boolean;
    alt?: string;
    class?: string;
    style?: string;
    fit?: "contain" | "fill";
  }

  let {
    image,
    target,
    hostSelected,
    hoverWhenSelected = false,
    alt = image.name ?? image.file,
    class: className = "",
    style = "",
    fit = "contain",
  }: Props = $props();

  let root = $state<HTMLDivElement | null>(null);
  let canvas = $state<HTMLCanvasElement | null>(null);
  let hovered = $state(false);
  let observedHostSelected = $state(false);
  let loading = $state(true);
  let failed = $state(false);
  let stillReady = $state(false);
  let url = $derived(attachmentUrl(image.file));
  let selected = $derived(hostSelected ?? observedHostSelected);
  let stopped = $derived(isGifStopped(target));
  let playing = $derived(shouldPlayGif({
    mode: gifPlayback.mode,
    stopped,
    selected,
    hovered,
    hoverWhenSelected,
  }));

  $effect(() => {
    const source = url;
    const currentCanvas = canvas;
    loading = Boolean(source);
    failed = !source;
    stillReady = false;
    if (!source || !currentCanvas) return;

    const frame = new Image();
    frame.onload = () => {
      if (!currentCanvas.isConnected || frame.naturalWidth <= 0 || frame.naturalHeight <= 0) {
        loading = false;
        failed = true;
        return;
      }
      const context = currentCanvas.getContext("2d");
      if (!context) {
        loading = false;
        failed = true;
        return;
      }
      currentCanvas.width = frame.naturalWidth;
      currentCanvas.height = frame.naturalHeight;
      context.drawImage(frame, 0, 0);
      loading = false;
      stillReady = true;
      frame.onload = null;
      frame.onerror = null;
      frame.removeAttribute("src");
    };
    frame.onerror = () => {
      loading = false;
      failed = true;
    };
    frame.src = source;

    return () => {
      frame.onload = null;
      frame.onerror = null;
      frame.removeAttribute("src");
    };
  });

  onMount(() => {
    if (hostSelected !== undefined || !root) return;
    const host = root.closest<HTMLElement>("[data-gif-host-selected]");
    if (!host) return;
    const sync = () => { observedHostSelected = host.dataset.gifHostSelected === "true"; };
    sync();
    const observer = new MutationObserver(sync);
    observer.observe(host, { attributes: true, attributeFilter: ["data-gif-host-selected"] });
    return () => observer.disconnect();
  });

  const targetAttributes = $derived.by(() => ({
    "data-gif-surface": "",
    "data-gif-target-kind": target.kind,
    "data-gif-note-id": target.noteId,
    "data-gif-position": target.kind === "inline" ? String(target.position) : undefined,
    "data-gif-row-id": target.kind === "tierlist" ? target.rowId : undefined,
    "data-gif-card-id": target.kind === "tierlist" ? target.cardId : undefined,
  }));

  function handleError(): void {
    failed = true;
  }
</script>

<div
  bind:this={root}
  class={`gif-view ${className}`}
  style={style}
  {...targetAttributes}
  data-gif-file={image.file}
  class:gif-view-loading={loading && !failed}
  onmouseenter={() => { hovered = true; }}
  onmouseleave={() => { hovered = false; }}
  ondragstart={(event) => event.preventDefault()}
>
  <canvas bind:this={canvas} class="gif-view-picture" aria-hidden="true" hidden={!stillReady || playing} style:object-fit={fit} style:height={fit === "fill" ? "100%" : "auto"}></canvas>
  {#if playing && !failed && url}
    <img class="gif-view-picture" src={url} {alt} draggable="false" onerror={handleError} style:object-fit={fit} style:height={fit === "fill" ? "100%" : "auto"} />
  {/if}
  {#if loading && !failed}
    <div class="gif-view-state">Loading image…</div>
  {:else if failed || !url}
    <div class="gif-view-state gif-view-error" role="img" aria-label={`File missing: ${image.name ?? image.file}`}>
      File missing: {image.name ?? image.file}
    </div>
  {/if}
</div>

<style>
  .gif-view {
    position: relative;
    display: block;
    max-width: 100%;
    overflow: hidden;
    line-height: 0;
  }

  .gif-view-loading {
    min-height: 32px;
    background: #202020;
  }

  .gif-view-picture {
    display: block;
    width: 100%;
    max-width: 100%;
    pointer-events: none;
    user-select: none;
  }

  .gif-view-picture[hidden] {
    display: none;
  }

  .gif-view-state {
    position: absolute;
    inset: 0;
    display: grid;
    min-height: 32px;
    place-items: center;
    padding: 8px;
    box-sizing: border-box;
    color: #a9a9a9;
    background: #202020;
    font: 11px/1.3 var(--ui-font, sans-serif);
    text-align: center;
    pointer-events: none;
  }

  .gif-view-error {
    color: #bdbdbd;
    background: #242424;
    overflow-wrap: anywhere;
  }
</style>
