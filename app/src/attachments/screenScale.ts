/**
 * Screen pixels per CSS pixel of an element inside the board. Measuring it (getBoundingClientRect)
 * forces a layout, and every picture on screen re-runs its draw effect on each zoom step, so the
 * ratio is measured once per size / note scale and then follows the zoom by arithmetic.
 */
export function createScreenScale(): (element: Element, boxWidth: number, zoom: number, revision: number) => number {
  let key = "";
  let perZoom = 0;
  return (element, boxWidth, zoom, revision) => {
    const nextKey = `${boxWidth}|${revision}`;
    if (key === nextKey && perZoom > 0) return perZoom * zoom;
    const scale = element.getBoundingClientRect().width / boxWidth;
    key = nextKey;
    perZoom = zoom > 0 && Number.isFinite(scale) ? scale / zoom : 0;
    return scale;
  };
}

type PendingMeasure = { element: Element; boxWidth: number; done: (scale: number) => void };

let pending: PendingMeasure[] = [];
let flushQueued = false;

function flushMeasurements(): void {
  flushQueued = false;
  const batch = pending;
  pending = [];
  // Read everything first (a single layout), then let the pictures react.
  const widths = batch.map((entry) => entry.element.isConnected ? entry.element.getBoundingClientRect().width : 0);
  batch.forEach((entry, index) => entry.done(widths[index] / entry.boxWidth));
}

/**
 * Same ratio, but a first measurement is queued instead of taken at once: when a zoom step mounts
 * many pictures, each one used to measure and then resize its canvas, so the next measurement forced
 * another layout — one per picture in a single frame. Queued elements are read together in one
 * microtask (one layout); the picture returns `null` meanwhile and `onMeasured` re-runs it.
 */
export function createBatchedScreenScale(
  onMeasured: () => void,
): (element: Element, boxWidth: number, zoom: number, revision: number) => number | null {
  let key = "";
  let perZoom = 0;
  let queuedKey = "";
  return (element, boxWidth, zoom, revision) => {
    const nextKey = `${boxWidth}|${revision}`;
    if (key === nextKey) return perZoom * zoom;
    if (queuedKey === nextKey) return null;
    queuedKey = nextKey;
    pending.push({
      element,
      boxWidth,
      done: (scale) => {
        if (queuedKey !== nextKey) return;
        queuedKey = "";
        key = nextKey;
        perZoom = zoom > 0 && Number.isFinite(scale) && scale > 0 ? scale / zoom : 0;
        onMeasured();
      },
    });
    if (!flushQueued) {
      flushQueued = true;
      queueMicrotask(flushMeasurements);
    }
    return null;
  };
}
