import { beforeEach, describe, expect, it, vi } from "vitest";
import "../src/mcp/writeMethods";
import { dispatchMcpRequest } from "../src/mcp/dispatcher";
import { getMcpMethod } from "../src/mcp/registry";
import { board, replaceBoard } from "../src/model/board.svelte";
import { replaceLinks } from "../src/model/links.svelte";
import { replaceZones } from "../src/model/zones.svelte";
import { history, clear as clearHistory, undo } from "../src/history/history.svelte";
import { selection } from "../src/selection/selection.svelte";
import { trash, archive, replaceTrash, replaceArchive } from "../src/model/retention.svelte";
import { type Note, type NoteKind } from "../src/model/note";
import { makeNote } from "../src/notes/noteCommands";
import { measuredHeights } from "../src/notes/layout.svelte";

const kinds: NoteKind[] = [
  "note", "pro", "con", "importance", "purpose", "mood", "beacon", "goal", "progress", "calculator", "tierlist", "stats",
  "archive", "trash", "inbox", "list", "source", "glossary", "map", "random", "markas", "time", "message", "calendar",
  "image", "pdf", "format", "audio", "video", "youtube",
];

function note(id: string, name: string, patch: Partial<Note> = {}): Note {
  return { id, type: "note", name, text: "", x: 100, y: 100, width: 30, height: null, ...patch };
}

function call<T>(name: string, params: unknown): T {
  const method = getMcpMethod(name);
  if (!method) throw new Error(`Missing MCP method ${name}`);
  return method.run(params as Record<string, unknown>) as T;
}

async function callAsync<T>(name: string, params: unknown): Promise<T> {
  const method = getMcpMethod(name);
  if (!method) throw new Error(`Missing MCP method ${name}`);
  return await method.run(params as Record<string, unknown>) as T;
}

function dataFor(type: NoteKind): Record<string, unknown> | undefined {
  if (type === "image") return { image: { file: "cat.png", mime: "image/png", size: 1, naturalWidth: 100, naturalHeight: 80 } };
  if (type === "pdf") return { media: { file: "file.pdf", mime: "application/pdf", size: 1, kind: "pdf" } };
  if (type === "format") return { media: { file: "file.txt", mime: "text/plain", size: 1, kind: "text" } };
  if (type === "audio") return { media: { file: "file.mp3", mime: "audio/mpeg", size: 1, kind: "audio" } };
  if (type === "video") return { media: { file: "clip.mp4", mime: "video/mp4", size: 1, kind: "video" } };
  if (type === "youtube") return { youtube: { videoId: "dQw4w9WgXcQ", url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ" } };
  return undefined;
}

beforeEach(() => {
  vi.unstubAllGlobals();
  replaceBoard([]);
  replaceLinks([]);
  replaceZones([]);
  replaceTrash([]);
  replaceArchive([]);
  selection.ids = [];
  selection.zoneIds = [];
  selection.primaryId = null;
  clearHistory();
  for (const id of Object.keys(measuredHeights)) delete measuredHeights[id];
});

describe("MCP node write methods", () => {
  it.each(kinds)("creates %s with the same Q-menu defaults", async (type) => {
    const data = dataFor(type);
    const now = vi.spyOn(Date, "now").mockReturnValue(1234);
    const expected = makeNote(type, "expected", { x: 500, y: 500 }, Date.now());
    let created: Array<{ id: string; name: string; x: number; y: number }>;
    try {
      ({ created } = await callAsync<{ created: Array<{ id: string; name: string; x: number; y: number }> }>("nodes.create", {
        nodes: [{ type, ...(data ? { data } : {}) }], origin: { x: 500, y: 500 },
      }));
    } finally {
      now.mockRestore();
    }
    const actual = board.notes[created[0]!.id]!;
    expect(actual.name).toBe(expected.name);
    const ignored = new Set(["id", "name", "x", "y", "createdAt", "file", ...(data ? Object.keys(data) : []), ...(type === "image" ? ["height"] : [])]);
    const expectedFields = Object.fromEntries(Object.entries(expected).filter(([key]) => !ignored.has(key)));
    expect(actual).toMatchObject(expectedFields);
  });

  it("creates refs and links in one history step and undoes the whole batch", async () => {
    const result = await callAsync<{ created: Array<{ ref?: string; id: string }>; links: string[] }>("nodes.create", {
      nodes: [
        { ref: "source", type: "note", name: "Source", x: 200, y: 200 },
        { ref: "child", type: "pro", name: "Child", near: { node: "source", side: "right" } },
      ],
      links: [{ from: "source", to: "child", shape: "wave" }],
    });
    expect(result.created.map((item) => item.ref)).toEqual(["source", "child"]);
    expect(result.links).toHaveLength(1);
    expect(Object.keys(board.notes)).toHaveLength(2);
    expect(Object.values(board.notes).map((item) => item.x)).toEqual(expect.arrayContaining([200]));
    expect(history.entries).toHaveLength(1);
    undo();
    expect(board.order).toEqual([]);
    expect(Object.keys(board.notes)).toEqual([]);
  });

  it("keeps auto placement clear of existing and newly created notes", async () => {
    replaceBoard([note("occupied", "Occupied", { x: 400, y: 400, width: 80, height: null })]);
    measuredHeights.occupied = 40;
    const { created } = await callAsync<{ created: Array<{ id: string; x: number; y: number; width: number; height: number }> }>("nodes.create", {
      nodes: Array.from({ length: 6 }, (_, index) => ({ name: `New ${index}` })),
      origin: { x: 400, y: 400 },
    });
    const placed = [board.notes.occupied!, ...created.map(({ id }) => board.notes[id]!)];
    for (let i = 0; i < placed.length; i += 1) {
      const first = placed[i]!;
      for (let j = i + 1; j < placed.length; j += 1) {
        const second = placed[j]!;
        const firstHeight = first.height ?? measuredHeights[first.id] ?? (created.find((item) => item.id === first.id)?.height ?? 8);
        const secondHeight = second.height ?? measuredHeights[second.id] ?? (created.find((item) => item.id === second.id)?.height ?? 8);
        expect(first.x + first.width <= second.x || second.x + second.width <= first.x || first.y + firstHeight <= second.y || second.y + secondHeight <= first.y).toBe(true);
      }
    }
  });

  it("returns actionable invalid_params errors for bad data and missing media", async () => {
    await expect(callAsync("nodes.create", { nodes: [{ type: "image" }] }))
      .rejects.toThrow(/image.*files\.import/);
    expect(board.order).toEqual([]);
    await expect(callAsync("nodes.create", { nodes: [{ type: "note", purposes: ["made-up"] }] }))
      .rejects.toMatchObject({ code: "invalid_params" });
    expect(board.order).toEqual([]);
  });

  it("updates text, exact text edits, rename, task and module fields", () => {
    replaceBoard([note("n1", "Before", { text: "alpha beta alpha" })]);
    call("nodes.update", { updates: [{ id: "n1", name: "After", textEdit: { find: "alpha", replace: "A", all: true }, task: true, importance: "medium", purposes: ["decision"], moods: ["curiosity"] }] });
    expect(board.notes.n1).toMatchObject({ name: "After", text: "A beta A", task: { done: false }, importance: "medium", purposes: ["decision"], moods: ["curiosity"] });
    expect(() => call("nodes.update", { updates: [{ id: "n1", textEdit: { find: "A", replace: "x" } }] })).toThrow(/Found 2 exact matches/);
    expect(board.notes.n1?.text).toBe("A beta A");
  });

  it("groups a multi-action update into one MCP Undo entry", async () => {
    replaceBoard([note("n1", "Original", { text: "before" })]);
    await dispatchMcpRequest({
      method: "nodes.update",
      params: { updates: [{ id: "n1", name: "Renamed", text: "after", task: true, importance: "medium", purposes: ["decision"], moods: ["curiosity"] }] },
    });
    expect(history.entries).toHaveLength(1);
    expect(history.entries[0]?.label).toBe("MCP: update 1 nodes");
    expect(board.notes.n1?.name).toBe("Renamed");
    undo();
    expect(board.notes.n1).toMatchObject({ name: "Original", text: "before" });
    expect(board.notes.n1?.task).toBeNull();
    expect(board.notes.n1?.importance).toBeUndefined();
    expect(board.notes.n1?.purposes).toBeUndefined();
    expect(board.notes.n1?.moods).toBeUndefined();
  });

  it("moves and arranges nodes without overlapping obstacles", async () => {
    replaceBoard([note("n1", "One"), note("n2", "Two", { x: 150 })]);
    call("nodes.move", { moves: [{ id: "n1", x: 400, y: 400 }, { id: "n2", x: 450, y: 400 }] });
    expect(board.notes.n1?.x).toBe(400);
    await callAsync("nodes.arrange", { ids: ["n1", "n2"], layout: "row", origin: { x: 600, y: 600 }, gap: 10 });
    const first = board.notes.n1!;
    const second = board.notes.n2!;
    expect(first.x + first.width <= second.x || second.x + second.width <= first.x || first.y + 8 <= second.y || second.y + 8 <= first.y).toBe(true);
  });

  it("reflows a tree layout with measured heights in one undo step", async () => {
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
      for (const id of board.order) {
        measuredHeights[id] = board.notes[id]?.type === "beacon" ? 14.7 : 11.4;
      }
      queueMicrotask(() => callback(0));
      return 1;
    });

    const response = await dispatchMcpRequest({
      method: "nodes.create",
      params: {
        layout: "tree",
        origin: { x: 500, y: 500 },
        gap: 2,
        nodes: [
          { ref: "root", type: "beacon", name: "Root" },
          ...Array.from({ length: 4 }, (_, index) => ({ ref: `child${index}`, text: `Line one ${index}\nLine two\nLine three` })),
        ],
        links: Array.from({ length: 4 }, (_, index) => ({ from: "root", to: `child${index}` })),
      },
    }) as { created: Array<{ id: string; ref: string; x: number; y: number; height: number }> };

    const children = response.created.filter(({ ref }) => ref.startsWith("child"))
      .map(({ id }) => board.notes[id]!)
      .sort((first, second) => first.y - second.y);
    for (const returned of response.created) {
      expect(board.notes[returned.id]).toMatchObject({ x: returned.x, y: returned.y });
    }
    expect(response.created.find(({ ref }) => ref === "root")?.height).toBe(7.2);
    expect(response.created.filter(({ ref }) => ref.startsWith("child")).map(({ height }) => height)).toEqual([11.4, 11.4, 11.4, 11.4]);
    for (let index = 1; index < children.length; index += 1) {
      expect(children[index]!.y).toBeGreaterThanOrEqual(children[index - 1]!.y + 11.4 + 2 - 1e-9);
    }
    expect(history.entries).toHaveLength(1);
    undo();
    expect(board.order).toEqual([]);
  });

  it("deletes to trash and archive through the app actions", () => {
    replaceBoard([note("n1", "Trash me"), note("n2", "Archive me")]);
    call("nodes.delete", { ids: ["n1"] });
    call("nodes.delete", { ids: ["n2"], mode: "archive" });
    expect(board.order).toEqual([]);
    expect(trash.entries.flatMap((entry) => entry.notes.map((item) => item.id))).toContain("n1");
    expect(archive.entries.map((entry) => entry.note.id)).toContain("n2");
  });
});
