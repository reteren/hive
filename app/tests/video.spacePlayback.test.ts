import { describe, expect, it, vi } from "vitest";
import { registerHoverPlayback, routePlaybackSpaceKeydown } from "../src/media-ui/hoverPlayback";

function spaceEvent(target: unknown = null): KeyboardEvent {
  const event = {
    code: "Space",
    repeat: false,
    altKey: false,
    ctrlKey: false,
    metaKey: false,
    shiftKey: false,
    defaultPrevented: false,
    target,
    preventDefault: vi.fn(),
    stopPropagation: vi.fn(),
  };
  event.preventDefault.mockImplementation(() => { event.defaultPrevented = true; });
  return event as unknown as KeyboardEvent;
}

describe("Space routing for hovered media playback", () => {
  it("toggles the hovered player and suppresses the board shortcut", () => {
    const toggle = vi.fn();
    const teleportToBeacon = vi.fn();
    const windowHandlers = new Map<string, (event: KeyboardEvent) => void>();
    const elementHandlers = new Map<string, () => void>();
    const fakeWindow = {
      addEventListener: (type: string, handler: EventListenerOrEventListenerObject) => {
        if (typeof handler === "function") windowHandlers.set(type, handler as (event: KeyboardEvent) => void);
      },
      removeEventListener: (type: string) => windowHandlers.delete(type),
    };
    const fakeDocument = { activeElement: null };
    const fakeElement = {
      addEventListener: (type: string, handler: EventListenerOrEventListenerObject) => {
        if (typeof handler === "function") elementHandlers.set(type, handler as () => void);
      },
      removeEventListener: (type: string) => elementHandlers.delete(type),
    };
    const originalWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
    const originalDocument = Object.getOwnPropertyDescriptor(globalThis, "document");
    Object.defineProperty(globalThis, "window", { value: fakeWindow, configurable: true });
    Object.defineProperty(globalThis, "document", { value: fakeDocument, configurable: true });
    const unregister = registerHoverPlayback(fakeElement as unknown as HTMLElement, toggle);
    elementHandlers.get("pointerenter")?.();
    const event = spaceEvent();
    windowHandlers.get("keydown")?.(event);
    if (!event.defaultPrevented) teleportToBeacon();
    unregister();
    if (originalWindow) Object.defineProperty(globalThis, "window", originalWindow);
    else Reflect.deleteProperty(globalThis, "window");
    if (originalDocument) Object.defineProperty(globalThis, "document", originalDocument);
    else Reflect.deleteProperty(globalThis, "document");

    expect(toggle).toHaveBeenCalledOnce();
    expect(event.preventDefault).toHaveBeenCalledOnce();
    expect(event.stopPropagation).toHaveBeenCalledOnce();
    expect(teleportToBeacon).not.toHaveBeenCalled();
  });

  it("leaves Space untouched while a text editor is focused", () => {
    const toggle = vi.fn();
    const event = spaceEvent();
    const editor = { tagName: "TEXTAREA", parentElement: null };

    expect(routePlaybackSpaceKeydown(event, editor, toggle)).toBe(false);
    expect(toggle).not.toHaveBeenCalled();
    expect(event.preventDefault).not.toHaveBeenCalled();
  });
});
