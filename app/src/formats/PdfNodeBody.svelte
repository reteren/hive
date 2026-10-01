<script lang="ts">
  import { onDestroy } from "svelte";
  import { normalizeNoteScale, type Note } from "../model/note";
  import { camera } from "../board/camera.svelte";
  import { attachmentUrl } from "../attachments/service";
  import { pdfFrameMetrics } from "./formatLogic";

  let { note }: { note: Note } = $props();
  let body = $state<HTMLDivElement | null>(null);
  let failed = $state(false);
  let frameWidth = $state(0);
  let frameHeight = $state(0);
  let inverseScale = $state(1);
  let hasAppliedMetrics = false;
  let resizeTimer: ReturnType<typeof setTimeout> | undefined;
  let source = $derived(note.media?.kind === "pdf" ? attachmentUrl(note.media.file) : "");
  let displayName = $derived(note.media?.name || note.name || "PDF");

  $effect(() => {
    source;
    failed = false;
  });

  $effect(() => {
    const element = body;
    const currentSource = source;
    const zoom = camera.zoom;
    const noteScale = normalizeNoteScale(note.scale);
    if (!element || !currentSource) return;

    const applyMetrics = (): void => {
      const metrics = pdfFrameMetrics(element.clientWidth, element.clientHeight, zoom, noteScale);
      frameWidth = metrics.width;
      frameHeight = metrics.height;
      inverseScale = metrics.inverseScale;
    };
    const scheduleMetrics = (): void => {
      if (!hasAppliedMetrics) {
        hasAppliedMetrics = true;
        applyMetrics();
        return;
      }
      if (resizeTimer !== undefined) clearTimeout(resizeTimer);
      resizeTimer = setTimeout(() => {
        resizeTimer = undefined;
        applyMetrics();
      }, 120);
    };

    const observer = new ResizeObserver(scheduleMetrics);
    observer.observe(element);
    scheduleMetrics();
    return () => {
      observer.disconnect();
      if (resizeTimer !== undefined) {
        clearTimeout(resizeTimer);
        resizeTimer = undefined;
      }
    };
  });

  onDestroy(() => {
    if (resizeTimer !== undefined) clearTimeout(resizeTimer);
  });
</script>

<div bind:this={body} class="pdf-node-body" aria-label={displayName}>
  {#if source && !failed}
    <iframe
      class="pdf-viewer"
      title={displayName}
      src={source}
      style:width={`${frameWidth}px`}
      style:height={`${frameHeight}px`}
      style:transform={`scale(${inverseScale})`}
      onerror={() => { failed = true; }}
    ></iframe>
  {:else}
    <div class="pdf-error" role="status">File missing: {displayName}</div>
  {/if}
</div>

<style>
  .pdf-node-body {
    position: relative;
    width: 100%;
    height: 100%;
    min-width: 0;
    min-height: 0;
    overflow: hidden;
    background: #202020;
  }

  .pdf-viewer {
    display: block;
    position: absolute;
    top: 0;
    left: 0;
    border: 0;
    background: #202020;
    transform-origin: top left;
  }

  .pdf-error {
    display: grid;
    width: 100%;
    height: 100%;
    min-height: 0;
    place-items: center;
    padding: 16px;
    box-sizing: border-box;
    color: #ffb5a8;
    text-align: center;
    background: #251e1d;
    border: 1px solid #653b35;
  }
</style>
