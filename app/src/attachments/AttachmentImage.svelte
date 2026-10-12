<script lang="ts">
  import { onMount } from "svelte";
  import { camera } from "../board/camera.svelte";
  import { attachmentUrl } from "./service";
  import { acquireDisplayBitmap, displayBitmapSize, type DisplayBitmapLease } from "./displayBitmap";
  import type { ImageRef } from "./types";

  interface Props {
    image: ImageRef;
    class?: string;
    style?: string;
    alt?: string;
  }

  let { image, class: className = "", style = "", alt = image.name ?? image.file }: Props = $props();
  let canvas = $state<HTMLCanvasElement | null>(null);
  let box = $state({ width: 0, height: 0 });
  let nearViewport = $state(false);
  let scaleRevision = $state(0);
  let intrinsicSize = $state({ width: 0, height: 0 });
  let loadState = $state<"loading" | "ready" | "error">("loading");
  let renderedKey = "";
  let src = $derived(attachmentUrl(image.file));
  let canvasFit = $derived(/(?:^|;)\s*object-fit\s*:\s*(contain|cover|fill|none|scale-down)\s*(?:;|$)/i.exec(style)?.[1] ?? "contain");
  let dimensionSource = "";

  $effect(() => {
    const currentSource = src;
    if (currentSource === dimensionSource) return;
    dimensionSource = currentSource;
    intrinsicSize = { width: image.naturalWidth, height: image.naturalHeight };
    renderedKey = "";
  });

  $effect(() => {
    const element = canvas;
    const source = src;
    const { width: boxWidth, height: boxHeight } = box;
    void camera.zoom;
    void scaleRevision;
    const ratio = typeof window === "undefined" ? 1 : window.devicePixelRatio || 1;
    if (!element || !source || boxWidth <= 0 || boxHeight <= 0 || !nearViewport) {
      if (element && !nearViewport) { element.width = 1; element.height = 1; renderedKey = ""; }
      return;
    }

    const sourceWidth = image.naturalWidth || intrinsicSize.width;
    const sourceHeight = image.naturalHeight || intrinsicSize.height;
    const screenScale = element.getBoundingClientRect().width / boxWidth;
    if (sourceWidth <= 0 || sourceHeight <= 0) {
      let current = true;
      const probe = new Image();
      probe.onload = () => {
        if (!current || !element.isConnected || probe.naturalWidth <= 0 || probe.naturalHeight <= 0) return;
        intrinsicSize = { width: probe.naturalWidth, height: probe.naturalHeight };
        const target = displayBitmapSize(probe.naturalWidth, probe.naturalHeight, boxWidth, boxHeight, screenScale * ratio);
        const key = `${source}\u0000${target.width}x${target.height}`;
        element.width = target.width;
        element.height = target.height;
        const context = element.getContext("2d");
        if (context) {
          context.clearRect(0, 0, target.width, target.height);
          context.drawImage(probe, 0, 0, target.width, target.height);
        }
        renderedKey = key;
        loadState = "ready";
        probe.removeAttribute("src");
      };
      probe.onerror = () => { if (current) loadState = "error"; };
      probe.src = source;
      return () => { current = false; probe.onload = null; probe.onerror = null; probe.removeAttribute("src"); };
    }

    const size = displayBitmapSize(sourceWidth, sourceHeight, boxWidth, boxHeight, screenScale * ratio);
    if (size.width <= 0 || size.height <= 0) return;
    const key = `${source}\u0000${size.width}x${size.height}`;
    if (renderedKey === key) return;
    let current = true;
    let lease: DisplayBitmapLease | null = null;
    loadState = "loading";
    void acquireDisplayBitmap(source, size.width, size.height).then((acquired) => {
      if (!current || !element.isConnected) {
        acquired.release();
        return;
      }
      lease = acquired;
      element.width = acquired.bitmap.width;
      element.height = acquired.bitmap.height;
      element.getContext("2d")?.drawImage(acquired.bitmap, 0, 0);
      renderedKey = key;
      loadState = "ready";
    }).catch(() => {
      if (current) loadState = "error";
    });
    return () => {
      current = false;
      lease?.release();
    };
  });

  onMount(() => {
    if (!canvas) return;
    const observer = new ResizeObserver(([entry]) => {
      if (!entry) return;
      box = { width: entry.contentRect.width, height: entry.contentRect.height };
    });
    observer.observe(canvas);
    const visibilityObserver = "IntersectionObserver" in window
      ? new IntersectionObserver(([entry]) => { nearViewport = Boolean(entry?.isIntersecting); }, { rootMargin: "240px" })
      : null;
    if (visibilityObserver) visibilityObserver.observe(canvas);
    else nearViewport = true;
    const noteCard = canvas.closest<HTMLElement>("[data-note-scale]");
    const scaleObserver = noteCard ? new MutationObserver(() => { scaleRevision += 1; }) : null;
    if (noteCard && scaleObserver) scaleObserver.observe(noteCard, { attributes: true, attributeFilter: ["data-note-scale"] });
    return () => { observer.disconnect(); visibilityObserver?.disconnect(); scaleObserver?.disconnect(); };
  });
</script>

{#if loadState === "error" || !src}
  <div class={`attachment-image-missing ${className}`} style={style} role="img" aria-label={`File missing: ${image.name ?? image.file}`}>
    <span>File missing: {image.name ?? image.file}</span>
  </div>
{:else}
  <div
    class={`attachment-image ${className}`}
    style={style}
    style:aspect-ratio={`${intrinsicSize.width || 16} / ${intrinsicSize.height || 9}`}
    class:attachment-image-loading={loadState === "loading"}
    role="img"
    aria-label={alt}
    aria-busy={loadState === "loading"}
  >
    <canvas bind:this={canvas} class="attachment-image-canvas" style={`width:100%;height:100%;object-fit:${canvasFit}`} aria-hidden="true" width="1" height="1"></canvas>
  </div>
{/if}

<style>
  .attachment-image {
    position: relative;
    display: block;
    max-width: 100%;
    max-height: 100%;
    overflow: hidden;
  }

  .attachment-image-canvas {
    position: absolute;
    inset: 0;
    display: block;
    width: 100%;
    height: 100%;
    object-fit: contain;
  }

  .attachment-image-loading {
    opacity: 0;
  }

  .attachment-image-missing {
    display: grid;
    min-width: 72px;
    min-height: 52px;
    place-items: center;
    box-sizing: border-box;
    padding: 8px;
    overflow: hidden;
    border: 1px solid #484848;
    background: #242424;
    color: #a8a8a8;
    font-size: 11px;
    text-align: center;
    overflow-wrap: anywhere;
  }
</style>
