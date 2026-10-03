import { normalizePdfZoom } from "./formatLogic";

export const PDF_RENDER_DEBOUNCE_MS = 150;
/** Pages within about two viewport heights above/below are rendered ahead, so scrolling shows them ready. */
export const PDF_PREFETCH_MARGIN = "200% 0px";
export const PDF_RENDER_MAX_DIMENSION = 8192;

export interface PdfPageSize {
  pageNumber: number;
  width: number;
  height: number;
}

export interface PdfPageLayout {
  scale: number;
  width: number;
  height: number;
}

/** Page layout is expressed only in node-local CSS pixels; camera zoom affects raster resolution separately. */
export function pdfPageLayout(
  pageWidth: number,
  pageHeight: number,
  contentWidth: number,
  zoom: unknown,
): PdfPageLayout {
  const safePageWidth = finitePositive(pageWidth);
  const safePageHeight = finitePositive(pageHeight);
  const safeContentWidth = finitePositive(contentWidth);
  if (safePageWidth === 0 || safePageHeight === 0 || safeContentWidth === 0) {
    return { scale: 0, width: 0, height: 0 };
  }

  const normalizedZoom = normalizePdfZoom(zoom);
  const width = safeContentWidth * (normalizedZoom === undefined ? 1 : normalizedZoom / 100);
  const scale = width / safePageWidth;
  return { scale, width, height: safePageHeight * scale };
}

export interface PdfBackingResolution {
  width: number;
  height: number;
  scale: number;
}

/** Account for display scale while bounding the canvas' longest backing side. */
export function pdfBackingResolution(
  cssWidth: number,
  cssHeight: number,
  devicePixelRatio: number,
  cameraZoom: number,
  noteScale: number,
  maxDimension = PDF_RENDER_MAX_DIMENSION,
): PdfBackingResolution {
  const safeWidth = finitePositive(cssWidth);
  const safeHeight = finitePositive(cssHeight);
  if (safeWidth === 0 || safeHeight === 0) return { width: 0, height: 0, scale: 0 };

  const maxSide = Math.max(1, Math.floor(finitePositive(maxDimension) || PDF_RENDER_MAX_DIMENSION));
  const requestedScale = positiveFactor(devicePixelRatio) * positiveFactor(cameraZoom) * positiveFactor(noteScale);
  const scale = Math.min(requestedScale, maxSide / Math.max(safeWidth, safeHeight));
  return {
    width: Math.min(maxSide, Math.max(1, Math.round(safeWidth * scale))),
    height: Math.min(maxSide, Math.max(1, Math.round(safeHeight * scale))),
    scale,
  };
}

export interface PdfRenderTaskLike {
  promise: Promise<unknown>;
  cancel(): void;
}

export interface PdfRenderScheduler {
  setVisible(pageNumber: number, visible: boolean): void;
  schedule(): void;
  reset(): void;
  destroy(): void;
}

/** Debounce visible page renders and cancel work whose layout generation is stale. */
export function createPdfRenderScheduler(
  renderPage: (pageNumber: number) => PdfRenderTaskLike | Promise<PdfRenderTaskLike>,
  options: { delayMs?: number; onError?: (error: unknown) => void } = {},
): PdfRenderScheduler {
  const delayMs = Math.max(0, options.delayMs ?? PDF_RENDER_DEBOUNCE_MS);
  const visiblePages = new Set<number>();
  const activeTasks = new Map<number, PdfRenderTaskLike>();
  let timer: ReturnType<typeof setTimeout> | null = null;
  let generation = 0;
  let destroyed = false;

  function cancelTask(task: PdfRenderTaskLike): void {
    try {
      task.cancel();
    } catch {
      // PDF.js can finish between scheduling cancellation and calling cancel().
    }
  }

  function clearTimer(): void {
    if (timer === null) return;
    clearTimeout(timer);
    timer = null;
  }

  function cancelActiveTasks(): void {
    for (const task of activeTasks.values()) cancelTask(task);
    activeTasks.clear();
  }

  async function renderVisiblePage(pageNumber: number, renderGeneration: number): Promise<void> {
    try {
      const task = await renderPage(pageNumber);
      if (destroyed || renderGeneration !== generation || !visiblePages.has(pageNumber)) {
        cancelTask(task);
        return;
      }

      activeTasks.set(pageNumber, task);
      try {
        await task.promise;
      } catch (error) {
        if (!destroyed && renderGeneration === generation && visiblePages.has(pageNumber)) {
          options.onError?.(error);
        }
      } finally {
        if (activeTasks.get(pageNumber) === task) activeTasks.delete(pageNumber);
      }
    } catch (error) {
      if (!destroyed && renderGeneration === generation && visiblePages.has(pageNumber)) {
        options.onError?.(error);
      }
    }
  }

  function schedule(): void {
    if (destroyed) return;
    generation += 1;
    const renderGeneration = generation;
    clearTimer();
    cancelActiveTasks();
    timer = setTimeout(() => {
      timer = null;
      for (const pageNumber of visiblePages) {
        void renderVisiblePage(pageNumber, renderGeneration);
      }
    }, delayMs);
  }

  function setVisible(pageNumber: number, visible: boolean): void {
    if (destroyed || !Number.isInteger(pageNumber) || pageNumber < 1) return;
    if (visible) {
      if (visiblePages.has(pageNumber)) return;
      visiblePages.add(pageNumber);
      // A page scrolling into view renders right away, without the zoom debounce and without
      // cancelling pages that are already rendering (that restart made scrolling feel slow).
      if (timer === null) void renderVisiblePage(pageNumber, generation);
      return;
    }

    visiblePages.delete(pageNumber);
    const task = activeTasks.get(pageNumber);
    if (task) {
      activeTasks.delete(pageNumber);
      cancelTask(task);
    }
  }

  function reset(): void {
    if (destroyed) return;
    generation += 1;
    clearTimer();
    cancelActiveTasks();
    visiblePages.clear();
  }

  function destroy(): void {
    if (destroyed) return;
    reset();
    destroyed = true;
  }

  return { setVisible, schedule, reset, destroy };
}

function finitePositive(value: number): number {
  return Number.isFinite(value) && value > 0 ? value : 0;
}

function positiveFactor(value: number): number {
  return Number.isFinite(value) && value > 0 ? value : 1;
}
