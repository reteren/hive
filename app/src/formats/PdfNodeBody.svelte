<script lang="ts">
  import { onDestroy } from "svelte";
  import type { PDFDocumentLoadingTask, PDFPageProxy } from "pdfjs-dist";
  import { attachmentUrl } from "../attachments/service";
  import { camera } from "../board/camera.svelte";
  import { normalizeNoteScale, type Note } from "../model/note";
  import { wheelScrollsText } from "../notes/textScroll";
  import { setPdfZoom } from "./formatActions";
  import { normalizePdfZoom, pdfZoomLabel, stepPdfZoom } from "./formatLogic";
  import {
    createPdfRenderScheduler,
    pdfBackingResolution,
    pdfPageLayout,
    type PdfPageSize,
    type PdfRenderTaskLike,
  } from "./pdfRenderLogic";

  let { note }: { note: Note } = $props();
  let documentViewport = $state<HTMLDivElement | null>(null);
  let pageSizes = $state<PdfPageSize[]>([]);
  let contentWidth = $state(0);
  let loading = $state(false);
  let loadError = $state("");
  let loadGeneration = 0;
  const pages = new Map<number, PDFPageProxy>();
  const canvases = new Map<number, HTMLCanvasElement>();

  let source = $derived(note.media?.kind === "pdf" ? attachmentUrl(note.media.file) : "");
  let pdfZoom = $derived(normalizePdfZoom(note.pdfZoom));
  let displayName = $derived(note.media?.name || note.name || "PDF");

  const renderer = createPdfRenderScheduler(renderPage, {
    onError: (error) => {
      const message = error instanceof Error ? error.message : String(error);
      loadError = `Could not render PDF page: ${message || "Unknown error"}`;
    },
  });

  function changeZoom(direction: -1 | 1): void {
    setPdfZoom(note.id, stepPdfZoom(note.pdfZoom, direction));
  }

  function layoutFor(pageNumber: number) {
    const page = pageSizes.find((item) => item.pageNumber === pageNumber);
    return page ? pdfPageLayout(page.width, page.height, contentWidth, pdfZoom) : { scale: 0, width: 0, height: 0 };
  }

  async function renderPage(pageNumber: number): Promise<PdfRenderTaskLike> {
    const page = pages.get(pageNumber);
    const canvas = canvases.get(pageNumber);
    const layout = layoutFor(pageNumber);
    if (!page || !canvas || layout.width <= 0 || layout.height <= 0) {
      throw new Error("PDF page is not ready to render.");
    }

    const resolution = pdfBackingResolution(
      layout.width,
      layout.height,
      window.devicePixelRatio,
      camera.zoom,
      normalizeNoteScale(note.scale),
    );
    if (resolution.width <= 0 || resolution.height <= 0) throw new Error("PDF page has no drawable size.");

    // Double buffer: render into an offscreen canvas and swap only when it is complete, so a
    // re-render after a zoom never blanks the visible page (the old bitmap stays, CSS-scaled).
    const offscreen = document.createElement("canvas");
    offscreen.width = resolution.width;
    offscreen.height = resolution.height;
    const viewport = page.getViewport({ scale: layout.scale });
    const task = page.render({
      canvas: offscreen,
      viewport,
      transform: [resolution.scale, 0, 0, resolution.scale, 0, 0],
      background: "rgb(255, 255, 255)",
    });
    return {
      cancel: () => task.cancel(),
      promise: task.promise.then(() => {
        if (canvases.get(pageNumber) !== canvas) return;
        canvas.width = offscreen.width;
        canvas.height = offscreen.height;
        canvas.getContext("2d")?.drawImage(offscreen, 0, 0);
        offscreen.width = 0;
        offscreen.height = 0;
      }),
    };
  }

  async function loadDocument(
    currentSource: string,
    request: number,
    setTask: (task: PDFDocumentLoadingTask) => void,
  ): Promise<void> {
    try {
      const { pdfjs } = await import("./pdfjsClient");
      if (request !== loadGeneration) return;
      const task = pdfjs.getDocument({ url: currentSource });
      setTask(task);
      const document = await task.promise;
      if (request !== loadGeneration) return;

      const loadedPages = await Promise.all(Array.from({ length: document.numPages }, async (_, index) => {
        const pageNumber = index + 1;
        const page = await document.getPage(pageNumber);
        const viewport = page.getViewport({ scale: 1 });
        return {
          page,
          size: { pageNumber, width: viewport.width, height: viewport.height },
        };
      }));
      if (request !== loadGeneration) return;

      pages.clear();
      for (const entry of loadedPages) pages.set(entry.size.pageNumber, entry.page);
      pageSizes = loadedPages.map((entry) => entry.size);
      loading = false;
      renderer.schedule();
    } catch (error) {
      if (request !== loadGeneration) return;
      loading = false;
      const message = error instanceof Error ? error.message : String(error);
      loadError = `Could not load PDF: ${message || "Unknown error"}`;
    }
  }

  function registerCanvas(node: HTMLCanvasElement, pageNumber: number) {
    canvases.set(pageNumber, node);
    return {
      destroy() {
        if (canvases.get(pageNumber) === node) canvases.delete(pageNumber);
      },
    };
  }

  function setPageVisible(pageNumber: number, visible: boolean): void {
    renderer.setVisible(pageNumber, visible);
    if (visible) return;
    const canvas = canvases.get(pageNumber);
    if (canvas) {
      canvas.width = 0;
      canvas.height = 0;
    }
  }

  function observePage(node: HTMLElement, pageNumber: number) {
    const root = node.closest(".pdf-document");
    if (!root) return { destroy() {} };

    const observer = new IntersectionObserver((entries) => {
      for (const entry of entries) setPageVisible(pageNumber, entry.isIntersecting);
    }, { root, rootMargin: "120px 0px", threshold: 0 });
    observer.observe(node);
    return {
      destroy() {
        observer.disconnect();
        setPageVisible(pageNumber, false);
      },
    };
  }

  function handleWheel(event: WheelEvent): void {
    const scroller = event.currentTarget as HTMLElement;
    if (event.deltaY !== 0) {
      if (wheelScrollsText(scroller.scrollTop, scroller.clientHeight, scroller.scrollHeight, event.deltaY)) {
        event.stopPropagation();
      }
      return;
    }

    const canScrollHorizontally = event.deltaX > 0
      ? scroller.scrollLeft + scroller.clientWidth < scroller.scrollWidth - 1
      : event.deltaX < 0 && scroller.scrollLeft > 1;
    if (canScrollHorizontally) event.stopPropagation();
  }

  $effect(() => {
    const currentSource = source;
    const request = ++loadGeneration;
    renderer.reset();
    pages.clear();
    canvases.clear();
    pageSizes = [];
    loadError = "";

    if (!currentSource) {
      loading = false;
      loadError = "File missing.";
      return;
    }

    loading = true;
    let task: PDFDocumentLoadingTask | null = null;
    void loadDocument(currentSource, request, (createdTask) => { task = createdTask; });
    return () => {
      if (loadGeneration === request) loadGeneration += 1;
      renderer.reset();
      if (task) void task.destroy().catch(() => {});
    };
  });

  $effect(() => {
    const element = documentViewport;
    if (!element) return;
    const updateWidth = (): void => { contentWidth = element.clientWidth; };
    const observer = new ResizeObserver(updateWidth);
    observer.observe(element);
    updateWidth();
    return () => observer.disconnect();
  });

  $effect(() => {
    pageSizes;
    contentWidth;
    pdfZoom;
    camera.zoom;
    note.scale;
    renderer.schedule();
  });

  onDestroy(() => renderer.destroy());
</script>

<div class="pdf-node-body" aria-label={displayName}>
  {#if source}
    <div class="pdf-controls" role="toolbar" aria-label="PDF zoom controls" data-selection-ignore>
      <button type="button" aria-label="Zoom out" title="Zoom out" disabled={pdfZoom === 50} onclick={() => changeZoom(-1)}>−</button>
      <output aria-label="PDF zoom level">{pdfZoomLabel(pdfZoom)}</output>
      <button type="button" aria-label="Zoom in" title="Zoom in" disabled={pdfZoom === 300} onclick={() => changeZoom(1)}>+</button>
      <button type="button" class="fit-width" aria-label="Fit width" onclick={() => setPdfZoom(note.id, undefined)}>Fit width</button>
    </div>
    <div bind:this={documentViewport} class="pdf-document" onwheel={handleWheel}>
      {#if loadError}
        <div class="pdf-message" role="alert">{loadError} {displayName}</div>
      {:else if loading}
        <div class="pdf-message" role="status">Loading {displayName}…</div>
      {:else}
        <div class="pdf-pages">
          {#each pageSizes as page (page.pageNumber)}
            {@const layout = pdfPageLayout(page.width, page.height, contentWidth, pdfZoom)}
            <div
              class="pdf-page"
              style:width={`${layout.width}px`}
              style:height={`${layout.height}px`}
              use:observePage={page.pageNumber}
            >
              <canvas
                aria-label={`PDF page ${page.pageNumber} of ${pageSizes.length}`}
                style:width={`${layout.width}px`}
                style:height={`${layout.height}px`}
                use:registerCanvas={page.pageNumber}
              ></canvas>
            </div>
          {/each}
        </div>
      {/if}
    </div>
  {:else}
    <div class="pdf-message missing" role="status">File missing: {displayName}</div>
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

  .pdf-controls .fit-width { min-width: auto; }

  .pdf-document {
    flex: 1 1 auto;
    min-width: 0;
    min-height: 0;
    overflow: auto;
    background: #202020;
    overscroll-behavior: contain;
  }

  .pdf-pages {
    display: flex;
    width: 100%;
    min-height: 100%;
    flex-direction: column;
    align-items: center;
    gap: 8px;
    padding: 8px 0;
    box-sizing: border-box;
  }

  .pdf-page {
    flex: 0 0 auto;
    overflow: hidden;
    background: #fff;
    box-shadow: 0 1px 5px rgb(0 0 0 / 45%);
  }

  .pdf-page canvas {
    display: block;
    max-width: none;
    background: #fff;
  }

  .pdf-message {
    display: grid;
    min-width: 0;
    min-height: 100%;
    place-items: center;
    padding: 16px;
    box-sizing: border-box;
    color: #c7c7c7;
    text-align: center;
  }

  .pdf-message[role="alert"],
  .pdf-message.missing {
    color: #ffb5a8;
    background: #251e1d;
  }
</style>
