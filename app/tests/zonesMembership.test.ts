import { beforeEach, describe, expect, it } from "vitest";
import { board, replaceBoard, updateNote } from "../src/model/board.svelte";
import type { Note } from "../src/model/note";
import { rectContour, type Zone } from "../src/model/zone";
import { replaceZones } from "../src/model/zones.svelte";
import { recomputeZoneMembership, zoneMembers, zoneOf } from "../src/zones/membership.svelte";

function note(id: string, x: number, y: number): Note {
  return { id, name: id, type: "note", text: "", x, y, width: 4, height: 4 };
}

function zone(id: string, x: number, y: number): Zone {
  return { id, name: id, color: "#608ac1", parts: [rectContour(x, y, 10, 10)], holes: [] };
}

describe("reactive zone membership computation", () => {
  beforeEach(() => { replaceBoard([]); replaceZones([]); });

  it("joins on contact, changes to greater area, and leaves when moved away", () => {
    replaceBoard([note("member", 10, 3)]);
    replaceZones([zone("a", 0, 0), zone("b", 10, 0)]);
    recomputeZoneMembership();
    expect(board.notes.member.zoneId).toBe("b");
    expect(zoneMembers("b")).toContain("member");
    updateNote("member", { x: 6 });
    recomputeZoneMembership();
    expect(board.notes.member.zoneId).toBe("a");
    updateNote("member", { x: 30 });
    recomputeZoneMembership();
    expect(board.notes.member.zoneId).toBeNull();
    expect(zoneOf("member")).toBeNull();
  });

  it("assigns a note that only touches a zone edge", () => {
    replaceBoard([note("edge", 10, 3)]);
    replaceZones([zone("a", 0, 0)]);
    recomputeZoneMembership();
    expect(board.notes.edge.zoneId).toBe("a");
  });

  it("keeps a prior zone on a tie and treats ME like a fixed beacon", () => {
    replaceBoard([{ ...note("member", 8, 3), zoneId: "a" }]);
    replaceZones([zone("a", 0, 0), zone("b", 10, 0), zone("me-zone", -5, -5)]);
    recomputeZoneMembership();
    expect(board.notes.member.zoneId).toBe("a");
    expect(zoneOf("me")).toBe("me-zone");
    expect(zoneMembers("me-zone")).toContain("me");
  });

  it("recomputes when a zone appears or disappears without moving a note", () => {
    replaceBoard([note("member", 2, 2)]);
    recomputeZoneMembership();
    expect(board.notes.member.zoneId).toBeUndefined();
    replaceZones([zone("a", 0, 0)]);
    recomputeZoneMembership();
    expect(board.notes.member.zoneId).toBe("a");
    replaceZones([]);
    recomputeZoneMembership();
    expect(board.notes.member.zoneId).toBeNull();
  });
});
