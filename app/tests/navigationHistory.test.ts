import { describe, expect, it } from "vitest";
import { NavigationHistory } from "../src/navigation/navigationHistory";

describe("teleport navigation history", () => {
  it("pushes origins and destinations, then moves back and forward", () => {
    const history = new NavigationHistory();
    const origin = { x: 10, y: -4, zoom: 1.5 };
    const first = { x: 20, y: 30, zoom: 1.5 };
    const second = { x: 40, y: 50, zoom: 2 };

    history.push(origin, first);
    history.push(first, second);

    expect(history.canGoBack).toBe(true);
    expect(history.canGoForward).toBe(false);
    expect(history.back()).toEqual(first);
    expect(history.back()).toEqual(origin);
    expect(history.back()).toBeUndefined();
    expect(history.forward()).toEqual(first);
    expect(history.forward()).toEqual(second);
    expect(history.forward()).toBeUndefined();
  });

  it("truncates forward entries when a new teleport follows back navigation", () => {
    const history = new NavigationHistory();
    const origin = { x: 0, y: 0, zoom: 1 };
    const first = { x: 10, y: 10, zoom: 1 };
    const second = { x: 20, y: 20, zoom: 1 };
    const branch = { x: -5, y: 8, zoom: 1.25 };

    history.push(origin, first);
    history.push(first, second);
    expect(history.back()).toEqual(first);
    history.push(first, branch);

    expect(history.entries).toEqual([origin, first, branch]);
    expect(history.canGoForward).toBe(false);
    expect(history.back()).toEqual(first);
    expect(history.forward()).toEqual(branch);
  });

  it("preserves an ordinary camera move as the origin of the next jump", () => {
    const history = new NavigationHistory();
    const first = { x: 10, y: 10, zoom: 1 };
    const panned = { x: 15, y: 8, zoom: 1.2 };
    const target = { x: 40, y: -2, zoom: 1.2 };

    history.push({ x: 0, y: 0, zoom: 1 }, first);
    history.push(panned, target);

    expect(history.back()).toEqual(panned);
    expect(history.back()).toEqual(first);
  });

  it("can synchronize its cursor with a teleport restored by Undo or Redo", () => {
    const history = new NavigationHistory();
    const origin = { x: 0, y: 0, zoom: 1 };
    const destination = { x: 10, y: 10, zoom: 1.5 };

    history.push(origin, destination);
    expect(history.pointTo(origin)).toBe(true);
    expect(history.canGoForward).toBe(true);
    expect(history.pointTo(destination)).toBe(true);
    expect(history.canGoForward).toBe(false);
    expect(history.pointTo({ x: 2, y: 3, zoom: 1 })).toBe(false);
  });
});
