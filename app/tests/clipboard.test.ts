import { describe, expect, it } from "vitest";
import type { Note } from "../src/model/note";
import {
  FALLBACK_PASTE_OFFSET,
  HIVE_CLIPBOARD_MARKER,
  HIVE_CLIPBOARD_VERSION,
  notesAsPlainText,
  parseNotesPayload,
  placeNotes,
  remapClipboardLinks,
  serializeNotes,
  taskFieldsForPaste,
  uniqueCopyNames,
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
      { from: "note-a", to: "other", kind: "weak", shape: "straight" },
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
    expect(parseNotesPayload(JSON.stringify({ marker: HIVE_CLIPBOARD_MARKER, version: 3, nodes: [], links: [] }))).toBeNull();

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
      { from: "note-a", to: "outside", kind: "weak", shape: "straight" },
    ], new Map([["note-a", "copy-a"], ["note-b", "copy-b"]]), () => "new-link");

    expect(copied).toEqual([{
      id: "new-link", from: "copy-a", to: "copy-b", kind: "strong", shape: "zigzag", fromAnchor: { x: 1, y: 0.5 },
    }]);
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
    };
    const parsed = parseNotesPayload(serializeNotes([source]));

    expect(parsed?.version).toBe(2);
    expect(parsed?.nodes[0]).toMatchObject({
      type: "pro",
      task: { done: true, doneAt: 1_700_000_000_000 },
      importance: "absolute",
      purposes: ["concept", "decision"],
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
    const legacyNodes = nodes.map(({ task: _task, importance: _importance, purposes: _purposes, ...node }) => node);
    const parsed = parseNotesPayload(JSON.stringify({ ...current, version: 1, nodes: legacyNodes }));

    expect(parsed?.nodes[0]).toMatchObject({
      type: "note", task: null, taskMemory: null, importance: null, purposes: [],
    });
  });

  it("round trips standalone Importance and Purpose node kinds", () => {
    const parsed = parseNotesPayload(serializeNotes([
      { ...noteA, id: "importance-1", type: "importance", importance: "important" },
      { ...noteB, id: "purpose-1", type: "purpose", purposes: ["quote"] },
    ]));

    expect(parsed?.nodes.map((node) => node.type)).toEqual(["importance", "purpose"]);
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
