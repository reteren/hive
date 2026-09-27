import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { board, replaceBoard } from "../src/model/board.svelte";
import { addLink, links, replaceLinks } from "../src/model/links.svelte";
import { clear as clearHistory, history, undo } from "../src/history/history.svelte";
import { smoothLinkAnchors, smoothLinesForObjects } from "../src/links/smoothLines";
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
  it("computes facing anchors on both rectangular frames", () => {
    const link: Pick<Link, "fromAnchor" | "toAnchor"> = {
      fromAnchor: { x: 0, y: 0 },
      toAnchor: { x: 1, y: 1 },
    };
    expect(smoothLinkAnchors(
      link,
      { bounds: { x: 0, y: 0, width: 100, height: 50 } },
      { bounds: { x: 150, y: 20, width: 50, height: 40 } },
    )).toEqual({
      fromAnchor: { x: 1, y: 0.8 },
      toAnchor: { x: 0, y: 0.125 },
    });
  });

  it("leaves circular endpoints radial and anchors the other frame toward them", () => {
    expect(smoothLinkAnchors(
      {},
      { bounds: { x: -3.6, y: -3.6, width: 7.2, height: 7.2 }, circular: true },
      { bounds: { x: 20, y: -10, width: 40, height: 20 } },
    )).toEqual({ toAnchor: { x: 0, y: 0.5 } });
  });

  it("smooths all incoming and outgoing links in one undoable action", () => {
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
    expect(links.byId.outgoing).toMatchObject({ fromAnchor: { x: 1, y: 0.8 }, toAnchor: { x: 0, y: 0.125 } });
    expect(links.byId.incoming?.toAnchor).toEqual({ x: 0, y: 0 });
    expect(history.cursor).toBe(1);

    undo();
    expect(links.byId.outgoing).toEqual(outgoing);
    expect(links.byId.incoming).toEqual(incoming);
    expect(board.order).toEqual(["source", "target", "other"]);
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
