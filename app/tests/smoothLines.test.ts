import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { board, replaceBoard } from "../src/model/board.svelte";
import { addLink, links, replaceLinks } from "../src/model/links.svelte";
import { clear as clearHistory, history, undo } from "../src/history/history.svelte";
import { removeLink } from "../src/model/links.svelte";
import { notifySelectionInteraction } from "../src/selection/selection.svelte";
import { reflowSmoothLineAnchorsRaw, smoothLinesForLinks, smoothLinesForObjects, toggleSmoothLinesForNote } from "../src/links/smoothLines";
import { anchorAlongRay, pointAtAnchor, resolveLinkEndpoints } from "../src/links/anchors";
import { noteMenuItems } from "../src/notes/noteMenu";
import { ME_OBJECT_ID, type Link } from "../src/model/link";
import type { Note } from "../src/model/note";

function note(id: string, x: number, y: number, width: number, height: number): Note {
  return { id, type: "note", name: id, text: "", x, y, width, height };
}

async function flushQueuedReflow(): Promise<void> {
  await Promise.resolve();
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
  it("freezes the unchanged endpoint, restores the node's saved anchors, and undoes each toggle once", () => {
    const source = note("source", 0, 0, 30, 20);
    const targetA = note("target-a", 50, 10, 30, 20);
    const targetB = note("target-b", 50, 10.4, 30, 20);
    replaceBoard([source, targetA, targetB]);
    const linkA: Link = { id: "link-a", from: source.id, to: targetA.id, kind: "strong", shape: "base" };
    const linkB: Link = {
      id: "link-b", from: source.id, to: targetB.id, kind: "weak", shape: "base",
      fromAnchor: { x: 0, y: 0.25 },
    };
    addLink(linkA);
    addLink(linkB);
    const beforeLinks = structuredClone([linkA, linkB]);
    const bounds = (value: Note) => ({ x: value.x, y: value.y, width: value.width, height: value.height ?? 20 });
    const beforeEnds = [linkA, linkB].map((link) => resolveLinkEndpoints(
      bounds(source), bounds(board.notes[link.to]!), link.fromAnchor, link.toAnchor,
    ).end);

    const smoothMenuItem = () => noteMenuItems(source.id).find((item) => item.id === "links.smoothLines");
    expect(smoothMenuItem()?.label(source.id)).toBe("Smooth lines");
    expect(toggleSmoothLinesForNote(source.id)).toBe(true);
    expect(smoothMenuItem()?.label(source.id)).toBe("Remove smooth");
    expect(board.notes[source.id]?.smoothLines).toBe(true);
    expect(board.notes[source.id]?.smoothLineAnchors).toEqual({ "link-a": null, "link-b": { x: 0, y: 0.25 } });
    expect(history.cursor).toBe(1);
    [linkA, linkB].forEach((link, index) => {
      const end = resolveLinkEndpoints(
        bounds(source), bounds(board.notes[link.to]!), links.byId[link.id]?.fromAnchor, links.byId[link.id]?.toAnchor,
      ).end;
      expect(end.x).toBeCloseTo(beforeEnds[index]!.x);
      expect(end.y).toBeCloseTo(beforeEnds[index]!.y);
    });

    expect(toggleSmoothLinesForNote(source.id)).toBe(true);
    expect(smoothMenuItem()?.label(source.id)).toBe("Smooth lines");
    expect(board.notes[source.id]?.smoothLines).toBeUndefined();
    expect(links.byId[linkA.id]?.fromAnchor).toBeUndefined();
    expect(links.byId[linkB.id]?.fromAnchor).toEqual({ x: 0, y: 0.25 });
    expect(history.cursor).toBe(2);
    undo();
    expect(board.notes[source.id]?.smoothLines).toBe(true);
    expect(links.byId[linkA.id]?.fromAnchor).toBeDefined();
    undo();
    expect(board.notes[source.id]?.smoothLines).toBeUndefined();
    expect(links.byId[linkA.id]).toEqual(beforeLinks[0]);
    expect(links.byId[linkB.id]).toEqual(beforeLinks[1]);
  });

  it("reflows after links are added or removed and after a linked node moves", async () => {
    const source = { ...note("source", 0, 0, 30, 20), smoothLines: true, smoothLineAnchors: {} };
    const targetA = note("target-a", 50, 10, 30, 20);
    const targetB = note("target-b", 50, 10.4, 30, 20);
    replaceBoard([source, targetA, targetB]);
    const linkA: Link = { id: "link-a", from: source.id, to: targetA.id, kind: "strong", shape: "base" };
    const linkB: Link = { id: "link-b", from: source.id, to: targetB.id, kind: "strong", shape: "base" };
    addLink(linkA);
    await flushQueuedReflow();
    const beforeAdd = links.byId[linkA.id]?.fromAnchor;
    addLink(linkB);
    await flushQueuedReflow();

    const aAnchor = links.byId[linkA.id]?.fromAnchor;
    const bAnchor = links.byId[linkB.id]?.fromAnchor;
    expect(aAnchor).toBeDefined();
    expect(bAnchor).toBeDefined();
    expect(aAnchor).not.toEqual(beforeAdd);
    expect(board.notes[source.id]?.smoothLineAnchors).toMatchObject({ "link-a": null, "link-b": null });
    const aPoint = pointAtAnchor({ x: source.x, y: source.y, width: source.width, height: 20 }, aAnchor!);
    const bPoint = pointAtAnchor({ x: source.x, y: source.y, width: source.width, height: 20 }, bAnchor!);
    expect(Math.hypot(aPoint.x - bPoint.x, aPoint.y - bPoint.y)).toBeGreaterThanOrEqual(1 - 1e-9);
    expect(beforeAdd).toBeDefined();

    removeLink(linkB.id);
    await flushQueuedReflow();
    expect(links.byId[linkA.id]?.fromAnchor).not.toEqual(aAnchor);
    const beforeMove = links.byId[linkA.id]?.fromAnchor;
    board.notes[targetA.id]!.x = -50;
    notifySelectionInteraction([targetA.id], "move");
    await flushQueuedReflow();
    expect(links.byId[linkA.id]?.fromAnchor).not.toEqual(beforeMove);
    expect(links.byId[linkA.id]?.fromAnchor).toEqual(anchorAlongRay(
      { x: source.x, y: source.y, width: source.width, height: 20 },
      { x: board.notes[targetA.id]!.x + 15, y: board.notes[targetA.id]!.y + 10 },
    ));
    expect(toggleSmoothLinesForNote(source.id)).toBe(true);
    expect(links.byId[linkA.id]?.fromAnchor).toBeUndefined();
    expect(board.notes[source.id]?.smoothLines).toBeUndefined();
  });

  it("freezes circular endpoints without changing their rendered contact points", () => {
    const target = note("target", 0, 0, 30, 20);
    const beaconA = { ...note("beacon-a", -50, 8.2, 7.2, 7.2), type: "beacon" as const };
    const beaconB = { ...note("beacon-b", -50, 8.6, 7.2, 7.2), type: "beacon" as const };
    replaceBoard([target, beaconA, beaconB]);
    const linksBefore: Link[] = [beaconA, beaconB].map((beacon) => ({
      id: `${beacon.id}-to-target`, from: beacon.id, to: target.id, kind: "strong", shape: "base",
    }));
    linksBefore.forEach(addLink);
    const before = linksBefore.map((link) => resolveLinkEndpoints(
      { x: board.notes[link.from]!.x, y: board.notes[link.from]!.y, width: 7.2, height: 7.2 },
      { x: target.x, y: target.y, width: target.width, height: 20 },
      undefined,
      undefined,
      true,
      false,
    ).start);

    expect(toggleSmoothLinesForNote(target.id)).toBe(true);
    linksBefore.forEach((link, index) => {
      const current = links.byId[link.id]!;
      expect(current.fromAnchor).toBeDefined();
      const after = resolveLinkEndpoints(
        { x: board.notes[link.from]!.x, y: board.notes[link.from]!.y, width: 7.2, height: 7.2 },
        { x: target.x, y: target.y, width: target.width, height: 20 },
        current.fromAnchor,
        current.toAnchor,
        true,
        false,
      ).start;
      expect(after.x).toBeCloseTo(before[index]!.x);
      expect(after.y).toBeCloseTo(before[index]!.y);
    });
  });

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
    expect(links.byId.outgoing).toMatchObject({ fromAnchor: { x: 1, y: 0.62 }, toAnchor: { x: 1, y: 1 } });
    expect(links.byId.incoming?.fromAnchor).toEqual({ x: 1, y: 1 });
    expect(links.byId.incoming?.toAnchor?.x).toBe(0);
    expect(links.byId.incoming?.toAnchor?.y).toBeCloseTo(1 / 18);
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

  it("chooses the facing edge from the centre ray, including side and distant diagonal cases", () => {
    const target = note("target", 0, 0, 20, 5);
    const beside = note("beside", 30, -1.5, 2, 2);
    const farAbove = note("far-above", 9, -100, 2, 2);
    replaceBoard([target, beside, farAbove]);
    addLink({ id: "beside-link", from: target.id, to: beside.id, kind: "strong", shape: "base" });
    addLink({ id: "above-link", from: target.id, to: farAbove.id, kind: "strong", shape: "base" });

    expect(smoothLinesForObjects([target.id])).toBe(true);
    expect(links.byId["beside-link"]?.fromAnchor?.x).toBe(1);
    expect(links.byId["above-link"]?.fromAnchor).toEqual({ x: 0.5, y: 0 });
  });

  it("keeps five targets in a right-hand column on the right edge when the edge has room", () => {
    const target = note("target", 0, 0, 20, 8);
    const outsiders = [-4, -2, 0, 2, 4].map((offset, index) => note(`right-${index}`, 39, 3 + offset, 2, 2));
    replaceBoard([target, ...outsiders]);
    outsiders.forEach((outsider, index) => addLink({
      id: `column-${index}`, from: target.id, to: outsider.id, kind: "strong", shape: "base",
    }));

    expect(smoothLinesForObjects([target.id])).toBe(true);
    const anchors = outsiders.map((_, index) => links.byId[`column-${index}`]!.fromAnchor!);
    expect(anchors.every((anchor) => anchor.x === 1)).toBe(true);
    const ys = anchors.map((anchor) => anchor.y * 8).sort((first, second) => first - second);
    for (let index = 1; index < ys.length; index += 1) {
      expect(ys[index] - ys[index - 1]).toBeGreaterThanOrEqual(1 - 1e-9);
    }
  });

  it("spills right-edge overflow to the adjacent edge closer to its targets", () => {
    const target = note("target", 0, 0, 20, 5);
    const outsiders = Array.from({ length: 5 }, (_, index) => note(`right-${index}`, 39, -4.5, 2, 2));
    replaceBoard([target, ...outsiders]);
    outsiders.forEach((outsider, index) => addLink({
      id: `overflow-${index}`, from: target.id, to: outsider.id, kind: "strong", shape: "base",
    }));

    expect(smoothLinesForObjects([target.id])).toBe(true);
    const anchors = outsiders.map((_, index) => links.byId[`overflow-${index}`]!.fromAnchor!);
    expect(anchors.filter((anchor) => anchor.x === 1)).toHaveLength(4);
    expect(anchors.filter((anchor) => anchor.y === 0)).toHaveLength(1);
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

  it("always spaces beacon links around their circular perimeter", () => {
    const beacon = { ...note("beacon", 20, 0, 7.2, 7.2), type: "beacon" as const };
    const targets = [-10, -5, 0, 5].map((y, index) => note(`target-${index}`, 60, y, 30, 20));
    replaceBoard([beacon, ...targets]);
    const circleBounds = { x: beacon.x, y: beacon.y, width: 7.2, height: 7.2 };
    targets.forEach((target, index) => addLink({
      id: `beacon-link-${index}`, from: beacon.id, to: target.id, kind: "strong", shape: "base",
    }));

    // Beacons are always smooth, so link insertion already derives these anchors.
    reflowSmoothLineAnchorsRaw();
    const anchors = targets.map((_, index) => links.byId[`beacon-link-${index}`]!.fromAnchor);
    expect(anchors.every(Boolean)).toBe(true);
    const points = targets.map((target, index) => resolveLinkEndpoints(
      circleBounds,
      { x: target.x, y: target.y, width: target.width, height: target.height ?? 20 },
      anchors[index],
      undefined,
      true,
      false,
    ).start);
    for (let first = 0; first < points.length; first += 1) {
      for (let second = first + 1; second < points.length; second += 1) {
        expect(Math.hypot(points[first]!.x - points[second]!.x, points[first]!.y - points[second]!.y)).toBeGreaterThanOrEqual(0.95);
      }
    }
  });

  it("distributes selected links at both endpoints when both nodes have smoothing enabled", () => {
    const sourceA = { ...note("source-a", 0, 0, 20, 20), smoothLines: true };
    const sourceB = { ...note("source-b", 0, 4, 20, 20), smoothLines: true };
    const targetA = { ...note("target-a", 60, 0, 20, 20), smoothLines: true };
    const targetB = { ...note("target-b", 60, 4, 20, 20), smoothLines: true };
    replaceBoard([sourceA, sourceB, targetA, targetB]);
    const pairs = [
      [sourceA, targetA], [sourceA, targetB], [sourceB, targetA], [sourceB, targetB],
    ] as const;
    pairs.forEach(([from, to], index) => addLink({
      id: `both-${index}`, from: from.id, to: to.id, kind: "strong", shape: "base",
    }));

    // Reflow treats both smooth endpoints as one batch when links are added.
    reflowSmoothLineAnchorsRaw();
    for (let index = 0; index < pairs.length; index += 1) {
      expect(links.byId[`both-${index}`]?.fromAnchor).toBeDefined();
      expect(links.byId[`both-${index}`]?.toAnchor).toBeDefined();
    }
    expect(links.byId["both-0"]?.fromAnchor).not.toEqual(links.byId["both-1"]?.fromAnchor);
    expect(links.byId["both-0"]?.toAnchor).not.toEqual(links.byId["both-2"]?.toAnchor);
  });
});
