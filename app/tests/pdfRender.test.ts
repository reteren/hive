import { afterEach, describe, expect, it, vi } from "vitest";
import { normalizePdfZoom, pdfZoomLabel } from "../src/formats/formatLogic";
import {
  createPdfRenderScheduler,
  PDF_RENDER_DEBOUNCE_MS,
  PDF_RENDER_MAX_DIMENSION,
  pdfBackingResolution,
  pdfPageLayout,
} from "../src/formats/pdfRenderLogic";

afterEach(() => {
  vi.useRealTimers();
});

describe("PDF page rendering", () => {
  it("keeps page layout in node-local CSS pixels and fits the content width", () => {
    const fit = pdfPageLayout(600, 800, 400, undefined);
    expect(fit.width).toBe(400);
    expect(fit.height).toBeCloseTo(800 * (400 / 600));

    const zoomed = pdfPageLayout(600, 800, 400, 150);
    expect(zoomed.width).toBe(600);
    expect(zoomed.height).toBe(800);
    expect(pdfPageLayout(600, 800, 400, 165).width).toBe(680);
  });

  it("sets backing pixels from device, camera and note scales", () => {
    expect(pdfBackingResolution(100, 200, 2, 3, 1.5)).toEqual({ width: 900, height: 1800, scale: 9 });
    expect(pdfBackingResolution(100, 50, 3, 4, 2, 1000)).toEqual({ width: 1000, height: 500, scale: 10 });
    expect(pdfBackingResolution(3000, 1000, 4, 2, 2)).toMatchObject({
      width: 8192,
      height: 2731,
      scale: 8192 / 3000,
    });
    expect(PDF_RENDER_MAX_DIMENSION).toBe(8192);
  });

  it("preserves the Fit label and normalized PDF zoom steps", () => {
    expect(normalizePdfZoom(undefined)).toBeUndefined();
    expect(normalizePdfZoom(165)).toBe(170);
    expect(pdfZoomLabel(undefined)).toBe("Fit");
    expect(pdfZoomLabel(100)).toBe("100%");
    expect(pdfZoomLabel(165)).toBe("170%");
  });

  it("debounces mocked PDF.js page renders and cancels stale work", async () => {
    vi.useFakeTimers();
    const firstRender = {
      promise: new Promise<void>(() => {}),
      cancel: vi.fn(),
    };
    const secondRender = { promise: Promise.resolve(), cancel: vi.fn() };
    const pages = new Map([
      [1, { render: vi.fn(() => secondRender) }],
      [2, { render: vi.fn(() => firstRender) }],
    ]);
    const pdfjs = {
      getDocument: vi.fn(() => ({
        promise: Promise.resolve({
          getPage: vi.fn(async (pageNumber: number) => pages.get(pageNumber)),
        }),
      })),
    };
    const document = await pdfjs.getDocument().promise;

    const scheduler = createPdfRenderScheduler(async (pageNumber) => {
      const page = await document.getPage(pageNumber);
      if (!page) throw new Error(`Unexpected PDF page ${pageNumber}.`);
      return page.render();
    });

    scheduler.setVisible(2, true);
    await vi.advanceTimersByTimeAsync(PDF_RENDER_DEBOUNCE_MS - 1);
    expect(pages.get(2)?.render).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    await Promise.resolve();
    expect(pages.get(2)?.render).toHaveBeenCalledTimes(1);
    expect(pages.get(1)?.render).not.toHaveBeenCalled();

    scheduler.schedule();
    expect(firstRender.cancel).toHaveBeenCalledTimes(1);
    scheduler.destroy();
    expect(firstRender.cancel).toHaveBeenCalledTimes(1);
  });
});
