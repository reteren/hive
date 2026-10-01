import { isTextEditingTarget } from "../commands/focus";

type HoveredPlayback = {
  element: HTMLElement;
  toggle: () => void;
};

const registrations = new Set<HoveredPlayback>();
let hoveredPlayback: HoveredPlayback | null = null;
let listenerInstalled = false;

function handleSpaceKeydown(event: KeyboardEvent): void {
  if (!hoveredPlayback) return;
  routePlaybackSpaceKeydown(event, typeof document === "undefined" ? null : document.activeElement, hoveredPlayback.toggle);
}

/** The shared event path is exported so pointer/editor routing can be tested without a browser. */
export function routePlaybackSpaceKeydown(event: KeyboardEvent, activeElement: unknown, toggle: () => void): boolean {
  if (
    event.code !== "Space" || event.repeat || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey ||
    event.defaultPrevented || isTextEditingTarget(event.target) || isTextEditingTarget(activeElement)
  ) return false;

  event.preventDefault();
  event.stopPropagation();
  toggle();
  return true;
}

/** Route Space to the media player under the pointer before board shortcuts run. */
export function registerHoverPlayback(element: HTMLElement, toggle: () => void): () => void {
  const registration: HoveredPlayback = { element, toggle };
  const onEnter = (): void => { hoveredPlayback = registration; };
  const onLeave = (): void => {
    if (hoveredPlayback === registration) hoveredPlayback = null;
  };

  registrations.add(registration);
  element.addEventListener("pointerenter", onEnter);
  element.addEventListener("pointerleave", onLeave);
  if (!listenerInstalled && typeof window !== "undefined") {
    window.addEventListener("keydown", handleSpaceKeydown, true);
    listenerInstalled = true;
  }

  return () => {
    element.removeEventListener("pointerenter", onEnter);
    element.removeEventListener("pointerleave", onLeave);
    registrations.delete(registration);
    if (hoveredPlayback === registration) hoveredPlayback = null;
    if (registrations.size === 0 && listenerInstalled && typeof window !== "undefined") {
      window.removeEventListener("keydown", handleSpaceKeydown, true);
      listenerInstalled = false;
    }
  };
}
