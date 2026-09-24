import { describe, expect, it } from "vitest";
import type { Note } from "../src/model/note";
import { rectContour, type Zone } from "../src/model/zone";
import {
  FALLBACK_PASTE_OFFSET,
  HIVE_CLIPBOARD_MARKER,
  HIVE_CLIPBOARD_VERSION,
  notesAsPlainText,
  parseNotesPayload,
  findNonOverlappingZoneOffset,
  placementOffset,
  placeNotes,
  remapClipboardLinks,
  serializeNotes,
  taskFieldsForPaste,
  uniqueCopyNames,
  zonesOverlap,
} from "../src/clipboard/payload";

const noteA: Note = {
  id: "note-a",
  type: "note",
  name: "Alpha",
  text: "first line\nsecond line",
  x: 0,
  y: 0,
  width: 10,
  height: null,
};

const noteB: Note = {
  id: "note-b",
  type: "note",
  name: "Beta",
  text: "body",
  x: 20,
  y: 10,
  width: 10,
  height: 8,
};

describe("clipboard payload", () => {
  it("serializes a versioned Hive payload with only internal links", () => {
    const serialized = serializeNotes([noteA, noteB], [
      {
        from: "note-a", to: "note-b", kind: "strong", shape: "wave",
        fromAnchor: { x: 1, y: 0.4 }, toAnchor: { x: 0, y: 0.7 },
      },
      { from: "note-a", to: "other", kind: "weak", shape: "base" },
    ]);
    const value = JSON.parse(serialized);

    expect(value).toMatchObject({
      marker: HIVE_CLIPBOARD_MARKER,
      version: HIVE_CLIPBOARD_VERSION,
      links: [{
        from: "note-a", to: "note-b", kind: "strong", shape: "wave",
        fromAnchor: { x: 1, y: 0.4 }, toAnchor: { x: 0, y: 0.7 },
      }],
      nodes: [
        { sourceId: "note-a", type: "note", name: "Alpha", text: noteA.text },
        { sourceId: "note-b", type: "note", name: "Beta", text: "body" },
      ],
    });
    expect(parseNotesPayload(serialized)?.nodes).toHaveLength(2);
  });

  it("rejects malformed, unknown, duplicate-id, and invalid-geometry payloads", () => {
    expect(parseNotesPayload("{")).toBeNull();
    expect(parseNotesPayload(JSON.stringify({ marker: "other", version: 1, nodes: [], links: [] }))).toBeNull();
    expect(parseNotesPayload(JSON.stringify({ marker: HIVE_CLIPBOARD_MARKER, version: 4, nodes: [], links: [] }))).toBeNull();

    const valid = JSON.parse(serializeNotes([noteA]));
    expect(parseNotesPayload(JSON.stringify({ ...valid, nodes: [valid.nodes[0], valid.nodes[0]] }))).toBeNull();
    expect(parseNotesPayload(JSON.stringify({
      ...valid,
      nodes: [{ ...valid.nodes[0], width: Number.POSITIVE_INFINITY }],
    }))).toBeNull();
    expect(parseNotesPayload(JSON.stringify({ ...valid, links: [{ from: "a", to: "b" }] }))).toBeNull();
    expect(parseNotesPayload(JSON.stringify({
      ...valid,
      nodes: [valid.nodes[0], { ...valid.nodes[0], sourceId: "note-b" }],
      links: [{ from: "note-a", to: "note-b", kind: "strong", shape: "straight", toAnchor: { x: 1.1, y: 0.5 } }],
    }))).toBeNull();
  });

  it("provides a readable plain-text representation for other apps", () => {
    expect(notesAsPlainText([noteA, noteB])).toBe("Alpha\nfirst line\nsecond line\n\nBeta\nbody");
  });

  it("remaps internal link endpoints to the newly pasted notes", () => {
    const copied = remapClipboardLinks([
      { from: "note-a", to: "note-b", kind: "strong", shape: "zigzag", fromAnchor: { x: 1, y: 0.5 } },
      { from: "note-a", to: "outside", kind: "weak", shape: "base" },
    ], new Map([["note-a", "copy-a"], ["note-b", "copy-b"]]), () => "new-link");

    expect(copied).toEqual([{
      id: "new-link", from: "copy-a", to: "copy-b", kind: "strong", shape: "zigzag", fromAnchor: { x: 1, y: 0.5 },
    }]);
  });

  it("migrates legacy straight and curved shapes while parsing copied links", () => {
    const payload = JSON.parse(serializeNotes([noteA, noteB], [
      { from: "note-a", to: "note-b", kind: "strong", shape: "base" },
    ])) as Record<string, unknown>;
    payload.links = [
      { from: "note-a", to: "note-b", kind: "strong", shape: "straight" },
    ];

    expect(parseNotesPayload(JSON.stringify(payload))?.links[0].shape).toBe("base");
    payload.links = [
      { from: "note-a", to: "note-b", kind: "strong", shape: "curved" },
    ];
    expect(parseNotesPayload(JSON.stringify(payload))?.links[0].shape).toBe("base");
  });

  it("round trips R3 fields and pastes completed tasks as open", () => {
    const source: Note = {
      ...noteA,
      id: "pro-note",
      type: "pro",
      task: { done: true, doneAt: 1_700_000_000_000 },
      taskMemory: { done: false, doneAt: null },
      importance: "absolute",
      purposes: ["concept", "decision", "concept"],
      moods: ["joy", "anger", "joy"],
    };
    const parsed = parseNotesPayload(serializeNotes([source]));

    expect(parsed?.version).toBe(3);
    expect(parsed?.nodes[0]).toMatchObject({
      type: "pro",
      task: { done: true, doneAt: 1_700_000_000_000 },
      importance: "absolute",
      purposes: ["concept", "decision"],
      moods: ["joy", "anger"],
    });
    expect(parsed?.nodes[0].taskMemory).toEqual({ done: false, doneAt: null });
    expect(taskFieldsForPaste(parsed!.nodes[0])).toEqual({
      task: { done: false, doneAt: null }, taskMemory: null,
    });
    expect(taskFieldsForPaste({ task: { done: false, doneAt: null }, taskMemory: { done: true, doneAt: 99 } })).toEqual({
      task: { done: false, doneAt: null }, taskMemory: null,
    });
    expect(taskFieldsForPaste({ task: null, taskMemory: null })).toEqual({ task: null, taskMemory: null });
  });

  it("reads v1 clipboard data with default R3 fields", () => {
    const current = JSON.parse(serializeNotes([noteA])) as Record<string, unknown>;
    const nodes = current.nodes as Array<Record<string, unknown>>;
    const legacyNodes = nodes.map((source) => {
      const node = { ...source };
      for (const field of ["task", "importance", "purposes", "moods", "color", "zoneId"]) delete node[field];
      return node;
    });
    const parsed = parseNotesPayload(JSON.stringify({ ...current, version: 1, nodes: legacyNodes }));

    expect(parsed?.nodes[0]).toMatchObject({
      type: "note", task: null, taskMemory: null, importance: null, purposes: [],
    });
  });

  it("reads v2 clipboard data and defaults zone fields", () => {
    const current = JSON.parse(serializeNotes([noteA])) as Record<string, unknown>;
    const nodes = (current.nodes as Array<Record<string, unknown>>).map((source) => {
      const node = { ...source };
      delete node.color;
      delete node.zoneId;
      return node;
    });
    const legacy: Record<string, unknown> = { ...current, version: 2, nodes };
    delete legacy.zones;

    const parsed = parseNotesPayload(JSON.stringify(legacy));
    expect(parsed?.version).toBe(3);
    expect(parsed?.zones).toEqual([]);
    expect(parsed?.nodes[0]).toMatchObject({ color: null, zoneId: null });
  });

  it("round trips standalone Importance, Purpose, and Mood node kinds", () => {
    const parsed = parseNotesPayload(serializeNotes([
      { ...noteA, id: "importance-1", type: "importance", importance: "important" },
      { ...noteB, id: "purpose-1", type: "purpose", purposes: ["quote"] },
      { ...noteA, id: "mood-1", type: "mood", moods: ["happiness", "joy"] },
    ]));

    expect(parsed?.nodes.map((node) => node.type)).toEqual(["importance", "purpose", "mood"]);
    expect(parsed?.nodes[2]?.moods).toEqual(["happiness", "joy"]);
  });

  it("rejects unknown Mood values instead of copying malformed module data", () => {
    const valid = JSON.parse(serializeNotes([
      { ...noteA, id: "mood-1", type: "mood", moods: ["happiness"] },
    ]));
    valid.nodes[0].moods = ["unknown"];
    expect(parseNotesPayload(JSON.stringify(valid))).toBeNull();
  });

  it("copies a beacon's colour and membership with zone-only and mixed selections", () => {
    const zone: Zone = {
      id: "zone-a", name: "Work", color: "#608ac1", parts: [rectContour(0, 0, 10, 8)], holes: [], createdAt: 42,
    };
    const beacon: Note = { ...noteA, id: "beacon-a", type: "beacon", color: "#69b7a5", zoneId: zone.id };

    const zoneOnly = parseNotesPayload(serializeNotes([], [], [zone]));
    expect(zoneOnly?.nodes).toEqual([]);
    expect(zoneOnly?.zones).toEqual([{ sourceId: zone.id, ...zone, id: undefined }].map(({ id: _id, ...value }) => value));

    const mixed = parseNotesPayload(serializeNotes([beacon], [], [zone]));
    expect(mixed?.nodes[0]).toMatchObject({ type: "beacon", color: "#69b7a5", zoneId: "zone-a" });
    expect(mixed?.zones[0]).toMatchObject({ sourceId: "zone-a", name: "Work", parts: zone.parts });
  });

  it("keeps mixed note and zone positions together and moves colliding zones clear", () => {
    const copied: Zone = { id: "copy", name: "Copy", color: "#608ac1", parts: [rectContour(0, 0, 10, 8)], holes: [] };
    const existing: Zone = { ...copied, id: "existing", name: "Existing" };
    const offset = placementOffset([noteA], [copied], { x: 100, y: 100 });
    expect(offset).toEqual({ x: 95, y: 96 });
    expect(zonesOverlap(copied, existing)).toBe(true);
    expect(zonesOverlap(copied, { ...existing, parts: [rectContour(10, 0, 10, 8)] })).toBe(false);
    expect(findNonOverlappingZoneOffset([copied], [existing])).toEqual({ x: 12, y: 0 });
    expect(findNonOverlappingZoneOffset([copied], [])).toEqual({ x: 0, y: 0 });
  });
});

describe("paste placement and names", () => {
  it("makes copy names unique against project names and earlier copies", () => {
    expect(uniqueCopyNames(["Alpha", "Beta", "Alpha"], ["Alpha", "Beta", "Beta 2"])).toEqual([
      "Alpha 2",
      "Beta 3",
      "Alpha 3",
    ]);
  });

  it("centers a group under the pointer while preserving its internal spacing", () => {
    const placed = placeNotes([noteA, noteB], { x: 50, y: 30 });

    expect(placed.map(({ x, y }) => ({ x, y }))).toEqual([
      { x: 35, y: 21 },
      { x: 55, y: 31 },
    ]);
    expect(placed[1].x - placed[0].x).toBe(noteB.x - noteA.x);
    expect(placed[1].y - placed[0].y).toBe(noteB.y - noteA.y);
  });

  it("offsets copies from their originals when there is no board pointer", () => {
    const placed = placeNotes([noteA, noteB], null);
    expect(placed.map(({ x, y }) => ({ x, y }))).toEqual([
      { x: noteA.x + FALLBACK_PASTE_OFFSET.x, y: noteA.y + FALLBACK_PASTE_OFFSET.y },
      { x: noteB.x + FALLBACK_PASTE_OFFSET.x, y: noteB.y + FALLBACK_PASTE_OFFSET.y },
    ]);
  });
});
