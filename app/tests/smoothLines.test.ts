import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { board, replaceBoard } from "../src/model/board.svelte";
import { addLink, links, replaceLinks } from "../src/model/links.svelte";
import { clear as clearHistory, history, undo } from "../src/history/history.svelte";
import { smoothLinesForObjects } from "../src/links/smoothLines";
import { pointAtAnchor } from "../src/links/anchors";
import { ME_OBJECT_ID, type Link } from "../src/model/link";
import type { Note } from "../src/model/note";

function note(id: string, x: number, y: number, width: number, height: number): Note {
  return { id, type: "note", name: id, text: "", x, y, width, height };
}

beforeEach(() => {
  replaceBoard([]);
  replaceLinks([]);
  clearHistory();
});

afterEach(() => {
  replaceBoard([]);
  replaceLinks([]);
  clearHistory();
});

describe("Smooth lines", () => {
  it("smooths incoming and outgoing links only at the requested object in one undo step", () => {
    const source = note("source", 0, 0, 100, 50);
    const target = note("target", 150, 20, 50, 40);
    const other = note("other", -100, -50, 30, 30);
    replaceBoard([source, target, other]);
    const outgoing: Link = {
      id: "outgoing", from: source.id, to: target.id, kind: "strong", shape: "base",
      fromAnchor: { x: 0, y: 0 }, toAnchor: { x: 1, y: 1 },
    };
    const incoming: Link = {
      id: "incoming", from: other.id, to: source.id, kind: "weak", shape: "wave",
      fromAnchor: { x: 1, y: 1 }, toAnchor: { x: 0, y: 0 },
    };
    addLink(outgoing);
    addLink(incoming);

    expect(smoothLinesForObjects([source.id])).toBe(true);
    expect(links.byId.outgoing).toMatchObject({ fromAnchor: { x: 1, y: 0.8 }, toAnchor: { x: 1, y: 1 } });
    expect(links.byId.incoming).toMatchObject({ fromAnchor: { x: 1, y: 1 }, toAnchor: { x: 0.01, y: 0 } });
    expect(history.cursor).toBe(1);

    undo();
    expect(links.byId.outgoing).toEqual(outgoing);
    expect(links.byId.incoming).toEqual(incoming);
    expect(board.order).toEqual(["source", "target", "other"]);
  });

  it("spaces many links along one edge and keeps every attachment clear of the corners", () => {
    const target = note("target", 0, 0, 20, 40);
    const outsiders = Array.from({ length: 12 }, (_, index) => note(`other-${index}`, -30, 19, 2, 2));
    replaceBoard([target, ...outsiders]);

    outsiders.forEach((outsider, index) => addLink({
      id: `link-${index}`, from: target.id, to: outsider.id, kind: "strong", shape: "base",
      fromAnchor: { x: 1, y: 1 }, toAnchor: { x: 0.25, y: 0.75 },
    }));

    expect(smoothLinesForObjects([target.id])).toBe(true);
    const bounds = { x: target.x, y: target.y, width: target.width, height: 40 };
    const anchors = outsiders.map((_, index) => links.byId[`link-${index}`]!.fromAnchor!);
    const points = anchors.map((anchor) => pointAtAnchor(bounds, anchor));
    const orderedY = points.map((point) => point.y).sort((first, second) => first - second);

    expect(anchors.every((anchor) => anchor.x === 0)).toBe(true);
    for (let index = 1; index < orderedY.length; index += 1) {
      expect(orderedY[index] - orderedY[index - 1]).toBeGreaterThanOrEqual(1 - 1e-9);
    }
    for (const point of points) {
      expect(point.y).toBeGreaterThanOrEqual(1);
      expect(point.y).toBeLessThanOrEqual(39);
    }
    for (let index = 0; index < outsiders.length; index += 1) {
      expect(links.byId[`link-${index}`]?.toAnchor).toEqual({ x: 0.25, y: 0.75 });
    }
  });

  it("preserves angular order on a shared edge so links do not cross", () => {
    const target = note("target", 0, 0, 20, 40);
    const upper = note("upper", -30, 4, 2, 2);
    const middle = note("middle", -30, 19, 2, 2);
    const lower = note("lower", -30, 34, 2, 2);
    replaceBoard([target, upper, middle, lower]);
    for (const outsider of [upper, middle, lower]) {
      addLink({ id: outsider.id, from: target.id, to: outsider.id, kind: "strong", shape: "base" });
    }

    expect(smoothLinesForObjects([target.id])).toBe(true);
    const bounds = { x: target.x, y: target.y, width: target.width, height: 40 };
    const point = (id: string) => pointAtAnchor(bounds, links.byId[id]!.fromAnchor!);
    expect(point("lower").y).toBeGreaterThan(point("middle").y);
    expect(point("middle").y).toBeGreaterThan(point("upper").y);
  });

  it("moves overflow to neighbouring edges when a short edge cannot fit all links", () => {
    const target = note("target", 0, 0, 20, 4.2);
    const outsiders = Array.from({ length: 8 }, (_, index) => note(`other-${index}`, -30, 1.1, 2, 2));
    replaceBoard([target, ...outsiders]);
    outsiders.forEach((outsider, index) => addLink({
      id: `short-${index}`, from: target.id, to: outsider.id, kind: "strong", shape: "base",
    }));

    expect(smoothLinesForObjects([target.id])).toBe(true);
    const bounds = { x: target.x, y: target.y, width: target.width, height: 4.2 };
    const points = outsiders.map((_, index) => pointAtAnchor(bounds, links.byId[`short-${index}`]!.fromAnchor!));
    const corners = [
      { x: 0, y: 0 }, { x: 20, y: 0 }, { x: 20, y: 4.2 }, { x: 0, y: 4.2 },
    ];

    for (let first = 0; first < points.length; first += 1) {
      const cornerDistance = Math.min(...corners.map((corner) => Math.hypot(
        points[first].x - corner.x,
        points[first].y - corner.y,
      )));
      expect(cornerDistance).toBeGreaterThanOrEqual(1 - 1e-9);
      for (let second = first + 1; second < points.length; second += 1) {
        expect(Math.hypot(points[first].x - points[second].x, points[first].y - points[second].y))
          .toBeGreaterThanOrEqual(1 - 1e-9);
      }
    }
  });

  it("clamps attachments facing the corners at least one unit along their selected edge", () => {
    const target = note("target", 0, 0, 20, 20);
    const outsiders = [
      note("north-west", -30, -30, 2, 2),
      note("north-east", 29, -30, 2, 2),
      note("south-east", 29, 29, 2, 2),
      note("south-west", -30, 29, 2, 2),
    ];
    replaceBoard([target, ...outsiders]);
    outsiders.forEach((outsider, index) => addLink({
      id: `corner-${index}`, from: target.id, to: outsider.id, kind: "strong", shape: "base",
    }));

    expect(smoothLinesForObjects([target.id])).toBe(true);
    const bounds = { x: target.x, y: target.y, width: target.width, height: 20 };
    const corners = [
      { x: 0, y: 0 }, { x: 20, y: 0 }, { x: 20, y: 20 }, { x: 0, y: 20 },
    ];
    for (let index = 0; index < outsiders.length; index += 1) {
      const anchor = links.byId[`corner-${index}`]?.fromAnchor;
      expect(anchor).toBeDefined();
      const point = pointAtAnchor(bounds, anchor!);
      expect(Math.min(...corners.map((corner) => Math.hypot(point.x - corner.x, point.y - corner.y))))
        .toBeGreaterThanOrEqual(1 - 1e-9);
    }
  });

  it("does not invent a frame anchor for ME or beacon circles", () => {
    const beacon = { ...note("beacon", 20, 0, 7.2, 7.2), type: "beacon" as const };
    const target = note("target", 60, -10, 30, 20);
    replaceBoard([beacon, target]);
    const link: Link = { id: "me-link", from: ME_OBJECT_ID, to: beacon.id, kind: "strong", shape: "base" };
    addLink(link);

    expect(smoothLinesForObjects([beacon.id])).toBe(false);
    expect(history.cursor).toBe(0);
    expect(links.byId[link.id]).toEqual(link);
  });
});
