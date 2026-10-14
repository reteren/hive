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
