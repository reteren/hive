<script lang="ts">
  import { onDestroy } from "svelte";
  import { normalizeNoteScale, type Note } from "../model/note";
  import { camera } from "../board/camera.svelte";
  import { attachmentUrl } from "../attachments/service";
  import { setPdfZoom } from "./formatActions";
  import { normalizePdfZoom, pdfFrameMetrics, pdfViewerSource, stepPdfZoom } from "./formatLogic";

  let { note }: { note: Note } = $props();
  let body = $state<HTMLDivElement | null>(null);
  let failed = $state(false);
  let frameWidth = $state(0);
  let frameHeight = $state(0);
  let inverseScale = $state(1);
  let hasAppliedMetrics = false;
  let resizeTimer: ReturnType<typeof setTimeout> | undefined;
  let source = $derived(note.media?.kind === "pdf" ? attachmentUrl(note.media.file) : "");
  let viewerSource = $derived(pdfViewerSource(source, note.pdfZoom));
  let pdfZoom = $derived(normalizePdfZoom(note.pdfZoom));
  let displayName = $derived(note.media?.name || note.name || "PDF");

  function changeZoom(direction: -1 | 1): void {
    setPdfZoom(note.id, stepPdfZoom(note.pdfZoom, direction));
  }

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
    <div class="pdf-controls" role="toolbar" aria-label="PDF zoom controls" data-selection-ignore>
      <button type="button" aria-label="Zoom out" title="Zoom out" disabled={pdfZoom === 50} onclick={() => changeZoom(-1)}>−</button>
      <output aria-label="PDF zoom level">{pdfZoom === undefined ? "Fit width" : `${pdfZoom}%`}</output>
      <button type="button" aria-label="Zoom in" title="Zoom in" disabled={pdfZoom === 300} onclick={() => changeZoom(1)}>+</button>
      <button type="button" class="fit-width" aria-label="Fit width" onclick={() => setPdfZoom(note.id, undefined)}>Fit width</button>
    </div>
    <iframe
      class="pdf-viewer"
      title={displayName}
      src={viewerSource}
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

  .pdf-controls {
    position: absolute;
    z-index: 1;
    top: 6px;
    right: 6px;
    display: flex;
    align-items: center;
    gap: 3px;
    padding: 3px;
    color: #e8e8e8;
    background: rgb(25 25 25 / 90%);
    border: 1px solid #505050;
    border-radius: 4px;
    font-family: inherit;
    font-size: 10px;
    line-height: 1.2;
    user-select: none;
  }

  .pdf-controls button {
    min-width: 22px;
    min-height: 21px;
    padding: 2px 5px;
    color: #e8e8e8;
    background: #303030;
    border: 1px solid #555;
    border-radius: 3px;
    font: inherit;
    cursor: pointer;
  }

  .pdf-controls button:hover:not(:disabled) {
    color: #fff;
    background: #404040;
  }

  .pdf-controls button:disabled {
    opacity: 0.45;
    cursor: default;
  }

  .pdf-controls output {
    min-width: 48px;
    color: #fff;
    text-align: center;
  }

  .pdf-controls .fit-width {
    min-width: auto;
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
