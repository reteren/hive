import { describe, expect, it } from "vitest";
import { replaceBoard, updateNote } from "../src/model/board.svelte";
import type { Note } from "../src/model/note";
import { rectContour, type Zone } from "../src/model/zone";
import { replaceZones, updateZone } from "../src/model/zones.svelte";
import { recomputeZoneMembership } from "../src/zones/membership.svelte";
import { createZoneMoveGesture, updateZoneMoveGesture } from "../src/zones/zoneGestures";

function zone(id: string, x: number, y: number, width: number, height: number): Zone {
  return { id, name: id, color: "#456789", parts: [rectContour(x, y, width, height)], holes: [] };
}

function note(id: string, x: number, y: number): Note {
  return { id, type: "note", name: id, text: "", x, y, width: 12, height: 12, zoneId: "target" };
}

describe("zone move performance", () => {
  it("keeps a 50-zone / 300-note move within a generous per-frame budget", () => {
    const target = zone("target", 0, 0, 1000, 1000);
    const obstacles = Array.from({ length: 49 }, (_, index) => zone(`obstacle-${index}`, 2000 + index * 100, 0, 40, 40));
    const notes = Array.from({ length: 300 }, (_, index) => note(`note-${index}`, 20 + (index % 20) * 24, 20 + Math.floor(index / 20) * 24));
    replaceZones([target, ...obstacles]);
    replaceBoard(notes);

    const members = notes.map(({ id, x, y }) => ({ id, x, y }));
    const gesture = createZoneMoveGesture(target, obstacles, members, { x: 0, y: 0 });
    const frameCount = 12;
    try {
      const started = performance.now();
      for (let frame = 1; frame <= frameCount; frame += 1) {
        const next = updateZoneMoveGesture(gesture, { x: frame, y: frame / 2 }, false, 10, true);
        updateZone(target.id, { parts: next.afterZone.parts, holes: next.afterZone.holes });
        for (const member of next.afterMembers) updateNote(member.id, { x: member.x, y: member.y });
        recomputeZoneMembership();
      }
      const millisecondsPerMove = (performance.now() - started) / frameCount;
      console.log(`zone move 50 zones / 300 notes: ${millisecondsPerMove.toFixed(2)} ms per move`);
      expect(millisecondsPerMove).toBeLessThan(100);
    } finally {
      replaceBoard([]);
      replaceZones([]);
    }
  });
});
