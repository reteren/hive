<script lang="ts">
  import type { Note } from "../model/note";
  import { attachmentUrl } from "../attachments/service";
  import { setPdfZoom } from "./formatActions";
  import { normalizePdfZoom, pdfFrameMetrics, pdfViewerSource, stepPdfZoom } from "./formatLogic";

  let { note }: { note: Note } = $props();
  let documentViewport = $state<HTMLDivElement | null>(null);
  let failed = $state(false);
  let frameWidth = $state(0);
  let frameHeight = $state(0);
  let inverseScale = $state(1);
  let source = $derived(note.media?.kind === "pdf" ? attachmentUrl(note.media.file) : "");
  let pdfZoom = $derived(normalizePdfZoom(note.pdfZoom));
  let viewerSource = $derived(pdfViewerSource(source, note.pdfZoom));
  let displayName = $derived(note.media?.name || note.name || "PDF");

  function changeZoom(direction: -1 | 1): void {
    setPdfZoom(note.id, stepPdfZoom(note.pdfZoom, direction));
  }

  $effect(() => {
    source;
    failed = false;
  });

  $effect(() => {
    const element = documentViewport;
    const currentSource = source;
    if (!element || !currentSource) return;

    const applyMetrics = (): void => {
      const metrics = pdfFrameMetrics(element.clientWidth, element.clientHeight);
      frameWidth = metrics.width;
      frameHeight = metrics.height;
      inverseScale = metrics.inverseScale;
    };

    const observer = new ResizeObserver(applyMetrics);
    observer.observe(element);
    applyMetrics();
    return () => observer.disconnect();
  });
</script>

<div class="pdf-node-body" aria-label={displayName}>
  {#if source && !failed}
    <div class="pdf-controls" role="toolbar" aria-label="PDF zoom controls" data-selection-ignore>
      <button type="button" aria-label="Zoom out" title="Zoom out" disabled={pdfZoom === 50} onclick={() => changeZoom(-1)}>−</button>
      <output aria-label="PDF zoom level">{pdfZoom === undefined ? "Fit" : `${pdfZoom}%`}</output>
      <button type="button" aria-label="Zoom in" title="Zoom in" disabled={pdfZoom === 300} onclick={() => changeZoom(1)}>+</button>
      <button type="button" class="fit-width" aria-label="Fit width" onclick={() => setPdfZoom(note.id, undefined)}>Fit width</button>
    </div>
    <div bind:this={documentViewport} class="pdf-document">
      <iframe
        class="pdf-viewer"
        title={displayName}
        src={viewerSource}
        style:width={`${frameWidth}px`}
        style:height={`${frameHeight}px`}
        style:transform={`scale(${inverseScale})`}
        onerror={() => { failed = true; }}
      ></iframe>
    </div>
  {:else}
    <div class="pdf-error" role="status">File missing: {displayName}</div>
  {/if}
</div>

<style>
  .pdf-node-body {
    display: flex;
    flex-direction: column;
    width: 100%;
    height: 100%;
    min-width: 0;
    min-height: 0;
    overflow: hidden;
    background: #202020;
  }

  .pdf-controls {
    position: relative;
    z-index: 1;
    display: flex;
    min-width: 0;
    min-height: 28px;
    flex: 0 0 28px;
    align-items: center;
    justify-content: center;
    gap: 3px;
    padding: 3px 5px;
    box-sizing: border-box;
    color: #e8e8e8;
    background: #252525;
    border-bottom: 1px solid #505050;
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
    min-width: 38px;
    color: #fff;
    text-align: center;
  }

  .pdf-controls .fit-width {
    min-width: auto;
  }

  .pdf-document {
    position: relative;
    flex: 1 1 auto;
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
    overflow-x: hidden;
    transform-origin: top left;
  }

  .pdf-error {
    display: grid;
    width: 100%;
    height: 100%;
    flex: 1 1 auto;
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
