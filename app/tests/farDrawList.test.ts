import { describe, expect, it } from "vitest";
import { buildFarDrawList, paintFarLinks } from "../src/board/farDrawList";
import type { FarLinkItem } from "../src/board/farDrawList";
import type { Note } from "../src/model/note";
import type { Zone } from "../src/model/zone";
import type { Link } from "../src/model/link";

function note(id: string, patch: Partial<Note> = {}): Note {
  return {
    id,
    type: "note",
    name: id,
    text: "",
    x: 0,
    y: 0,
    width: 30,
    height: 10,
    ...patch,
  };
}

describe("far canvas draw lists", () => {
  it("uses paint order for spatial candidates and excludes selected DOM objects", () => {
    const image = note("image", {
      type: "image",
      x: 20,
      image: { file: "photo.png", mime: "image/png", size: 4, naturalWidth: 2, naturalHeight: 2 },
    });
    const later = note("later", { x: 5 });
    const done = note("done", { task: { done: true, doneAt: 1 }, x: 2, color: "#123456", accentColor: "#abcdef" });
    const zone: Zone = {
      id: "zone",
      name: "Zone",
      color: "#ff0000",
      parts: [[{ x: 0, y: 0 }, { x: 30, y: 0 }, { x: 30, y: 30 }, { x: 0, y: 30 }]],
      holes: [],
    };
    const link: Link = { id: "link", from: "done", to: "image", kind: "weak", shape: "base" };
    const result = buildFarDrawList({
      noteIds: ["done", "image", "later"],
      notes: { image, done, later },
      noteBounds: (value) => ({ x: value.x, y: value.y, width: value.width, height: value.height ?? 0 }),
      noteOrder: new Map([["done", 0], ["image", 1], ["far", 2], ["later", 3]]),
      selectedNoteIds: new Set(["done"]),
      zoneIds: ["zone"],
      zones: { zone },
      linkIds: ["link"],
      links: { link },
      routePoints: () => [{ x: 1, y: 1 }, { x: 4, y: 4 }],
    });

    expect(result.notes.map((item) => item.id)).toEqual(["image", "later"]);
    expect(result.notes[0]).toMatchObject({ kind: "image", frame: "#353535", opacity: 1 });
    expect(result.zones.map((item) => item.id)).toEqual(["zone"]);
    expect(result.links.map((item) => item.id)).toEqual(["link"]);
    expect(result.drawCalls).toBe(6);
  });

  it("uses kind and node colors, dims completed tasks, and draws beacon data separately", () => {
    const pro = note("pro", { type: "pro", task: { done: true, doneAt: 2 }, width: 18 });
    const beacon = note("beacon", { type: "beacon", color: "#00aa88", width: 7.2, height: 7.2 });
    const result = buildFarDrawList({
      noteIds: ["pro", "beacon"],
      notes: { pro, beacon },
      noteBounds: (value) => ({ x: value.x, y: value.y, width: value.width, height: value.height ?? 0 }),
      noteOrder: new Map([["pro", 0], ["beacon", 1]]),
      zoneIds: [],
      zones: {},
      linkIds: [],
      links: {},
      routePoints: () => undefined,
    });

    expect(result.notes[0]).toMatchObject({ frame: "#293d2e", body: "#202d23", opacity: 0.6, headerHeight: 2.4 });
    expect(result.beacons[0]).toMatchObject({ kind: "beacon", frame: "#00aa88" });
    expect(result.drawCalls).toBe(3);
  });

  it("batches links by kind and opacity into a small number of strokes", () => {
    const links: FarLinkItem[] = Array.from({ length: 120 }, (_, index) => ({
      id: `link-${index}`,
      kind: index < 20 ? "weak" : "strong",
      points: [{ x: index, y: 0 }, { x: index + 1, y: 1 }, { x: index + 2, y: 0 }],
      opacity: index % 2 === 0 ? 1 : 0.3,
    }));
    let strokes = 0;
    let lineSegments = 0;
    const context = {
      setLineDash: () => undefined,
      beginPath: () => undefined,
      moveTo: () => undefined,
      lineTo: () => { lineSegments += 1; },
      closePath: () => undefined,
      stroke: () => { strokes += 1; },
    } as unknown as CanvasRenderingContext2D;

    const paintCalls = paintFarLinks(context, links, 1);

    expect(paintCalls).toBe(4);
    expect(strokes).toBe(4);
    expect(lineSegments).toBe(links.length * 2);
  });
});
