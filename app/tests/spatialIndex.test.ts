import { describe, expect, it } from "vitest";
import { GridIndex } from "../src/board/spatialIndex";
import { noteShowsFull, tierForZoom } from "../src/board/visibility.svelte";
import { estimatedNoteHeight } from "../src/notes/layout.svelte";

describe("GridIndex", () => {
  it("finds rectangles that intersect a query, including ones spanning many cells", () => {
    const index = new GridIndex(10, 16);
    index.set("a", { x: 0, y: 0, width: 5, height: 5 });
    index.set("b", { x: 100, y: 100, width: 5, height: 5 });
    index.set("huge", { x: -1000, y: -1000, width: 2000, height: 2000 });
    expect(index.query({ x: -1, y: -1, width: 3, height: 3 }).sort()).toEqual(["a", "huge"]);
    expect(index.queryPoint({ x: 102, y: 103 }).sort()).toEqual(["b", "huge"]);
  });

  it("follows moves and deletions", () => {
    const index = new GridIndex(10);
    index.set("a", { x: 0, y: 0, width: 5, height: 5 });
    index.set("a", { x: 500, y: 500, width: 5, height: 5 });
    expect(index.query({ x: 0, y: 0, width: 10, height: 10 })).toEqual([]);
    expect(index.query({ x: 495, y: 495, width: 10, height: 10 })).toEqual(["a"]);
    index.delete("a");
    expect(index.size).toBe(0);
    expect(index.query({ x: -1e6, y: -1e6, width: 2e6, height: 2e6 })).toEqual([]);
  });

  it("answers a viewport query on a 20 000-note board without visiting every note", () => {
    const index = new GridIndex(64);
    for (let i = 0; i < 20_000; i += 1) index.set(`n${i}`, { x: (i % 200) * 45, y: Math.floor(i / 200) * 30, width: 30, height: 12 });
    const started = performance.now();
    let found = 0;
    for (let run = 0; run < 100; run += 1) found = index.query({ x: 1000, y: 600, width: 300, height: 200 }).length;
    expect(found).toBeGreaterThan(20);
    expect(found).toBeLessThan(200);
    expect((performance.now() - started) / 100).toBeLessThan(2);
  });
});

describe("level of detail", () => {
  it("switches tiers with hysteresis", () => {
    expect(tierForZoom(1, "full")).toBe("full");
    expect(tierForZoom(0.18, "full")).toBe("full");
    expect(tierForZoom(0.15, "full")).toBe("simple");
    expect(tierForZoom(0.18, "simple")).toBe("simple");
    expect(tierForZoom(0.21, "simple")).toBe("full");
    expect(tierForZoom(0.05, "simple")).toBe("min");
    expect(tierForZoom(0.12, "min")).toBe("min");
    expect(tierForZoom(0.14, "min")).toBe("simple");
  });

  it("keeps a note's text by its size on screen: big notes much farther out than small ones", () => {
    expect(noteShowsFull(0.25, 1, false)).toBe(true);
    expect(noteShowsFull(0.15, 1, false)).toBe(false);
    expect(noteShowsFull(0.18, 1, true)).toBe(true);
    expect(noteShowsFull(0.18, 1, false)).toBe(false);
    // A 4x note still shows its text at the farthest zoom; a half-size note loses it sooner.
    expect(noteShowsFull(0.06, 4, false)).toBe(true);
    expect(noteShowsFull(0.3, 0.5, false)).toBe(false);
  });

  it("estimates the height of a never-drawn text note from its wrapped lines", () => {
    const short = estimatedNoteHeight({ type: "note", text: "one line", width: 30 });
    const long = estimatedNoteHeight({ type: "note", text: "word ".repeat(200), width: 30 });
    expect(long).toBeGreaterThan(short * 3);
    expect(estimatedNoteHeight({ type: "image", text: "", width: 20 })).toBe(6);
  });
});
