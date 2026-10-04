/**
 * Cached client rect of a board-sized element. Pointer handlers ran getBoundingClientRect() on every
 * move, right after other handlers had changed styles, which forced a full synchronous layout per
 * event. The rect only changes on resize/scroll, so it is cached and dropped on those (and on
 * pointerdown, as a cheap safety net for layout shifts that keep the size).
 */
const cache = new WeakMap<Element, DOMRect>();
const observed = new WeakSet<Element>();
let listening = false;
let generation = 0;
const generations = new WeakMap<Element, number>();

function invalidateAll(): void {
  generation += 1;
}

function listen(): void {
  if (listening || typeof window === "undefined") return;
  listening = true;
  window.addEventListener("resize", invalidateAll);
  window.addEventListener("scroll", invalidateAll, true);
  window.addEventListener("pointerdown", invalidateAll, true);
}

const resizeObserver = typeof ResizeObserver === "undefined"
  ? null
  : new ResizeObserver((entries) => {
    for (const entry of entries) cache.delete(entry.target);
  });

export function cachedClientRect(element: Element): DOMRect {
  listen();
  if (!observed.has(element)) {
    observed.add(element);
    resizeObserver?.observe(element);
  }
  const cached = cache.get(element);
  if (cached && generations.get(element) === generation) return cached;
  const rect = element.getBoundingClientRect();
  cache.set(element, rect);
  generations.set(element, generation);
  return rect;
}
