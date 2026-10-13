<script lang="ts">
  import { onMount } from "svelte";
  import { camera } from "../board/camera.svelte";
  import type { ImageRef } from "./types";
  import { attachmentUrl } from "./service";
  import { acquireDisplayBitmap, displayBitmapSize, peekAnyDisplayBitmap, type DisplayBitmapLease } from "./displayBitmap";
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
  // Mounted only near the viewport; the observer corrects this, but the first frame already draws.
  let visibleOnScreen = $state(true);
  let box = $state({ width: 0, height: 0 });
  let scaleRevision = $state(0);
  let loading = $state(true);
  let failed = $state(false);
  let stillReady = $state(false);
  /** Source whose still is currently on the canvas (any resolution). */
  let drawnSource = "";
  let url = $derived(attachmentUrl(image.file));
  let selected = $derived(hostSelected ?? observedHostSelected);
  let stopped = $derived(isGifStopped(target));
  let playing = $derived((visibleOnScreen || selected) && shouldPlayGif({
    mode: gifPlayback.mode,
    stopped,
    selected,
    hovered,
    hoverWhenSelected,
  }));

  $effect(() => {
    const source = url;
    const currentCanvas = canvas;
    const { width: boxWidth, height: boxHeight } = box;
    void camera.zoom;
    void scaleRevision;
    const ratio = typeof window === "undefined" ? 1 : window.devicePixelRatio || 1;
    const shouldLoadStill = visibleOnScreen || selected;
    failed = !source;
    // Off-screen stills are freed after a while, not at once (see AttachmentImage: blink on zoom).
    const clear = !shouldLoadStill && currentCanvas
      ? setTimeout(() => { currentCanvas.width = 1; currentCanvas.height = 1; drawnSource = ""; stillReady = false; }, 3000)
      : 0;
    if (clear) return () => clearTimeout(clear);
    // A zoom step only swaps the still's resolution: keep the drawn still (and no "Loading…") until
    // the new decode is ready — resetting here made GIFs blink while zooming.
    if (drawnSource !== source) {
      loading = Boolean(source);
      stillReady = false;
    }
    if (!source || !currentCanvas || boxWidth <= 0 || boxHeight <= 0 || !shouldLoadStill) return;

    const sourceWidth = image.naturalWidth || 480;
    const sourceHeight = image.naturalHeight || 270;
    const screenScale = currentCanvas.getBoundingClientRect().width / boxWidth;
    const size = displayBitmapSize(sourceWidth, sourceHeight, boxWidth, boxHeight, screenScale * ratio);
    if (size.width <= 0 || size.height <= 0) return;
    let active = true;
    let lease: DisplayBitmapLease | null = null;

    const draw = (bitmap: ImageBitmap): void => {
      if (!active || !currentCanvas.isConnected) return;
      currentCanvas.width = bitmap.width;
      currentCanvas.height = bitmap.height;
      const context = currentCanvas.getContext("2d");
      if (context) {
        context.clearRect(0, 0, currentCanvas.width, currentCanvas.height);
        context.drawImage(bitmap, 0, 0);
      }
      loading = false;
      stillReady = true;
      drawnSource = source;
    };

    if (drawnSource !== source && image.naturalWidth > 0 && image.naturalHeight > 0) {
      const cached = peekAnyDisplayBitmap(source, size.width, size.height);
      if (cached) draw(cached);
    }

    if (image.naturalWidth > 0 && image.naturalHeight > 0) {
      void acquireDisplayBitmap(source, size.width, size.height).then((acquired) => {
        if (!active) acquired.release();
        else { lease = acquired; draw(acquired.bitmap); }
      }).catch(() => { if (active) { loading = false; failed = true; } });
    } else {
      // Inline GIFs do not persist dimensions; resolve their ratio once, then draw only a bounded still.
      const frame = new Image();
      frame.onload = () => {
        if (!active || frame.naturalWidth <= 0 || frame.naturalHeight <= 0) return;
        const screenScale = currentCanvas.getBoundingClientRect().width / boxWidth;
        const target = displayBitmapSize(frame.naturalWidth, frame.naturalHeight, boxWidth, boxHeight, screenScale * ratio);
        const still = document.createElement("canvas");
        still.width = target.width;
        still.height = target.height;
        const stillContext = still.getContext("2d");
        stillContext?.clearRect(0, 0, target.width, target.height);
        stillContext?.drawImage(frame, 0, 0, target.width, target.height);
        currentCanvas.width = target.width;
        currentCanvas.height = target.height;
        const targetContext = currentCanvas.getContext("2d");
        targetContext?.clearRect(0, 0, target.width, target.height);
        targetContext?.drawImage(still, 0, 0);
        still.width = 0;
        still.height = 0;
        loading = false;
        stillReady = true;
        drawnSource = source;
        frame.removeAttribute("src");
      };
      frame.onerror = () => { if (active) { loading = false; failed = true; } };
      frame.src = source;
      return () => { active = false; frame.onload = null; frame.onerror = null; frame.removeAttribute("src"); };
    }

    return () => {
      active = false;
      lease?.release();
    };
  });

  onMount(() => {
    if (!root) return;
    const sizeObserver = new ResizeObserver(([entry]) => {
      if (entry) box = { width: entry.contentRect.width, height: entry.contentRect.height };
    });
    sizeObserver.observe(root);
    if ("IntersectionObserver" in window) {
      const visibilityObserver = new IntersectionObserver(([entry]) => { visibleOnScreen = Boolean(entry?.isIntersecting); });
      visibilityObserver.observe(root);
      const noteCard = root.closest<HTMLElement>("[data-note-scale]");
      const scaleObserver = noteCard ? new MutationObserver(() => { scaleRevision += 1; }) : null;
      if (noteCard && scaleObserver) scaleObserver.observe(noteCard, { attributes: true, attributeFilter: ["data-note-scale"] });
      if (hostSelected !== undefined) return () => { sizeObserver.disconnect(); visibilityObserver.disconnect(); scaleObserver?.disconnect(); };
      const host = root.closest<HTMLElement>("[data-gif-host-selected]");
      if (!host) return () => { sizeObserver.disconnect(); visibilityObserver.disconnect(); scaleObserver?.disconnect(); };
      const sync = () => { observedHostSelected = host.dataset.gifHostSelected === "true"; };
      sync();
      const observer = new MutationObserver(sync);
      observer.observe(host, { attributes: true, attributeFilter: ["data-gif-host-selected"] });
      return () => { sizeObserver.disconnect(); visibilityObserver.disconnect(); scaleObserver?.disconnect(); observer.disconnect(); };
    }
    visibleOnScreen = true;
    if (hostSelected !== undefined) return () => sizeObserver.disconnect();
    const host = root.closest<HTMLElement>("[data-gif-host-selected]");
    if (!host) return () => sizeObserver.disconnect();
    const sync = () => { observedHostSelected = host.dataset.gifHostSelected === "true"; };
    sync();
    const observer = new MutationObserver(sync);
    observer.observe(host, { attributes: true, attributeFilter: ["data-gif-host-selected"] });
    return () => { sizeObserver.disconnect(); observer.disconnect(); };
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
  style:aspect-ratio={`${image.naturalWidth || 16} / ${image.naturalHeight || 9}`}
  {...targetAttributes}
  data-gif-file={image.file}
  class:gif-view-loading={loading && !failed}
  onmouseenter={() => { hovered = true; }}
  onmouseleave={() => { hovered = false; }}
  ondragstart={(event) => event.preventDefault()}
>
  <canvas bind:this={canvas} class="gif-view-picture" aria-hidden="true" hidden={!stillReady || playing} style:object-fit={fit} style:height="100%"></canvas>
  {#if playing && !failed && url}
    <img class="gif-view-picture" src={url} {alt} draggable="false" onerror={handleError} style:object-fit={fit} style:height="100%" />
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
    height: 100%;
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
