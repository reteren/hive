import { beforeEach, describe, expect, it } from "vitest";
import "../src/mcp/readMethods";
import { McpError, getMcpMethod, mcpMethodNames } from "../src/mcp/registry";
import { board, replaceBoard } from "../src/model/board.svelte";
import { replaceLinks } from "../src/model/links.svelte";
import { archive, replaceArchive, replaceTrash, trash } from "../src/model/retention.svelte";
import { zones as zoneState, replaceZones } from "../src/model/zones.svelte";
import { project } from "../src/project/project.svelte";
import { selection } from "../src/selection/selection.svelte";
import { camera, viewport } from "../src/board/camera.svelte";
import { measuredHeights } from "../src/notes/layout.svelte";
import { NOTE_KINDS } from "../src/mcp/read/schema";
import { IMPORTANCE_LEVELS, MOOD_KINDS, PURPOSE_KINDS, R5_BASE_WIDTHS, type Note, type NoteKind } from "../src/model/note";
import type { TrashEntry, ArchiveEntry } from "../src/model/retention.svelte";
import { rectContour } from "../src/model/zone";

function note(id: string, type: NoteKind, name: string, patch: Partial<Note> = {}): Note {
  return {
    id,
    type,
    name,
    text: "",
    x: 200,
    y: 200,
    width: 30,
    height: null,
    ...patch,
  };
}

function call<T>(name: string, params: unknown = {}): T {
  const method = getMcpMethod(name);
  if (!method) throw new Error(`Missing MCP method ${name}`);
  return method.run(params as Record<string, unknown>) as T;
}

function zone(id: string, name: string, x: number, y: number, width: number, height: number) {
  return {
    id,
    name,
    color: "#608ac1",
    parts: [rectContour(x, y, width, height)],
    holes: [],
  };
}

beforeEach(() => {
  const first = note("n1", "note", "Alpha", {
    text: "# Hello **world**\n![Cat](att:cat.png){w=50}",
    x: 10,
    y: 20,
    task: { done: false, doneAt: null },
    createdAt: 30,
  });
  const second = note("n2", "pro", "Beta", { text: "The quick fox", x: 80, y: 10, task: { done: true, doneAt: 40 }, createdAt: 20 });
  const third = note("n3", "note", "Gamma", { text: "quiet", x: 220, y: 210, createdAt: 10 });
  replaceBoard([first, second, third]);
  replaceLinks([
    { id: "l1", from: "n1", to: "n2", kind: "strong", shape: "wave" },
    { id: "l2", from: "me", to: "n3", kind: "weak", shape: "orthogonal" },
  ]);
  replaceZones([zone("z1", "Research", 0, 0, 70, 100)]);
  replaceTrash([]);
  replaceArchive([]);
  project.path = "C:/projects/sample";
  project.name = "Sample";
  project.ready = true;
  selection.ids = ["n2"];
  camera.x = 50;
  camera.y = 40;
  camera.zoom = 2;
  viewport.width = 1000;
  viewport.height = 500;
  for (const id of Object.keys(measuredHeights)) delete measuredHeights[id];
});

describe("MCP read methods", () => {
  it("registers all contract read methods without mutating the board", () => {
    expect(mcpMethodNames()).toEqual([
      "archive.list", "links.list", "nodes.get", "nodes.list", "schema", "search", "status", "trash.list", "zones.list",
    ]);
    const before = board.order.slice();
    call("status");
    call("schema");
    expect(board.order).toEqual(before);
  });

  it("reports project state, counts, selection, camera and board-space viewport bounds", () => {
    project.path = "\\\\?\\C:\\projects\\sample";
    const result = call<{
      appVersion: string;
      protocol: number;
      project: { name: string; root: string };
      counts: { nodes: number; links: number; zones: number; trash: number; archive: number };
      camera: { x: number; y: number; zoom: number };
      viewport: { x: number; y: number; width: number; height: number };
      selection: string[];
    }>("status");

    expect(result).toMatchObject({
      appVersion: "1.6.9",
      protocol: 1,
      project: { name: "Sample", root: "C:\\projects\\sample" },
      counts: { nodes: 3, links: 2, zones: 1, trash: 0, archive: 0 },
      camera: { x: 50, y: 40, zoom: 2 },
      viewport: { x: 25, y: 27.5, width: 50, height: 25 },
      selection: ["n2"],
    });
  });

  it("generates a complete node schema from the model constants", () => {
    const result = call<{
      kinds: Array<{ type: NoteKind; label: string; defaultWidth: number; hasText: boolean; dataFields: Record<string, string> }>;
      enums: { importance: string[]; purposes: string[]; moods: string[]; linkKinds: string[]; linkShapes: string[] };
      markdown: string;
    }>("schema");

    expect(result.kinds.map((kind) => kind.type)).toEqual(NOTE_KINDS);
    expect(result.kinds).toHaveLength(30);
    expect(result.kinds.find((kind) => kind.type === "note")).toMatchObject({ hasText: true, defaultWidth: 30 });
    expect(result.kinds.find((kind) => kind.type === "calculator")?.dataFields.calculatorData).toContain("entries");
    expect(result.kinds.find((kind) => kind.type === "image")?.dataFields.image).toContain("naturalWidth");
    expect(result.enums).toEqual({
      importance: [...IMPORTANCE_LEVELS],
      purposes: [...PURPOSE_KINDS],
      moods: [...MOOD_KINDS],
      linkKinds: ["strong", "weak"],
      linkShapes: ["base", "orthogonal", "zigzag", "wave"],
    });
    for (const [type, width] of Object.entries(R5_BASE_WIDTHS)) {
      expect(result.kinds.find((kind) => kind.type === type)?.defaultWidth).toBe(width);
    }
    expect(result.markdown).toContain("![alt](att:");
    expect(result.markdown).toContain("hive://point/x,y");
  });

  it("filters, searches and paginates nodes using effective geometry and task state", () => {
    measuredHeights.n1 = 18;

    expect(call<{ total: number; nodes: Array<{ id: string }> }>("nodes.list", { types: ["note"], task: "open" })).toMatchObject({
      total: 1,
      nodes: [{ id: "n1" }],
    });
    expect(call<{ total: number; nodes: Array<{ id: string }> }>("nodes.list", { bbox: { x: 0, y: 0, width: 70, height: 100 } })).toMatchObject({
      total: 1,
      nodes: [{ id: "n1" }],
    });
    expect(call<{ total: number; nodes: Array<{ id: string }> }>("nodes.list", { query: "quick", sort: "position" })).toMatchObject({
      total: 1,
      nodes: [{ id: "n2" }],
    });
    expect(call<{ total: number; nodes: Array<{ id: string }> }>("nodes.list", { linkedTo: "n1" })).toMatchObject({
      total: 1,
      nodes: [{ id: "n2" }],
    });
    expect(call<{ total: number; nodes: Array<{ id: string; height: number }> }>("nodes.list", { sort: "name", limit: 1, offset: 1 })).toMatchObject({
      total: 3,
      nodes: [{ id: "n2", height: 6 }],
    });
  });

  it("returns full nodes by id or case-insensitive name, including file, links, zone and plain preview", () => {
    measuredHeights.n1 = 18;
    const result = call<{ nodes: Array<Record<string, unknown>>; missing: string[] }>("nodes.get", {
      ids: ["n1", "missing-id"],
      names: ["alpha", "missing-name"],
    });

    expect(result.missing).toEqual(["missing-id", "missing-name"]);
    expect(result.nodes).toHaveLength(1);
    expect(result.nodes[0]).toMatchObject({
      id: "n1",
      file: "Alpha.md",
      height: 18,
      links: [{ id: "l1", fromName: "Alpha", toName: "Beta", shape: "wave" }],
      zone: { id: "z1", name: "Research" },
    });
    expect(result.nodes[0]?.text).toBe("# Hello **world**\n![Cat](att:cat.png){w=50}");
  });

  it("returns panel-ranked search results with matchedIn and snippets", () => {
    const result = call<{ results: Array<{ id: string; name: string; type: NoteKind; matchedIn: string; snippet: string }> }>("search", {
      query: "quick",
      types: ["pro"],
    });
    expect(result.results).toEqual([{ id: "n2", name: "Beta", type: "pro", matchedIn: "text", snippet: "The quick fox" }]);
  });

  it("returns named links, zone membership and retention entries", () => {
    const linksResult = call<{ links: Array<{ id: string; fromName: string; toName: string; kind: string; shape: string }> }>("links.list", { nodeId: "n3" });
    expect(linksResult.links).toEqual([{ id: "l2", from: "me", to: "n3", kind: "weak", shape: "orthogonal", fromName: "ME", toName: "Gamma" }]);

    const zonesResult = call<{ zones: Array<{ id: string; name: string; nodeIds: string[] }> }>("zones.list");
    expect(zonesResult.zones).toEqual([{ ...zoneState.byId.z1, nodeIds: ["n1", "me"] }]);

    const trashEntry: TrashEntry = { id: "t1", deletedAt: 200, notes: [note("gone", "note", "Old note")], zones: [], links: [] };
    const archiveEntry: ArchiveEntry = { id: "a1", archivedAt: 100, note: note("archived", "pro", "Archived"), links: [] };
    replaceTrash([trashEntry]);
    replaceArchive([archiveEntry]);
    expect(trash.entries).toHaveLength(1);
    expect(archive.entries).toHaveLength(1);
    expect(call("trash.list")).toEqual({ entries: [{ id: "t1", name: "Old note", type: "note", deletedAt: 200 }] });
    expect(call("archive.list")).toEqual({ entries: [{ id: "a1", name: "Archived", type: "pro", deletedAt: 100 }] });
  });

  it("returns actionable errors for missing projects and invalid or missing ids", () => {
    project.path = "";
    try {
      call("nodes.list");
      throw new Error("Expected a missing project error");
    } catch (error) {
      expect(error).toBeInstanceOf(McpError);
      expect(error).toMatchObject({ code: "no_project" });
    }
    project.path = "C:/projects/sample";
    project.ready = false;
    try {
      call("nodes.list");
      throw new Error("Expected a loading project error");
    } catch (error) {
      expect(error).toBeInstanceOf(McpError);
      expect(error).toMatchObject({ code: "busy" });
    }
    project.ready = true;

    try {
      call("nodes.list", { types: ["not-a-node"] });
      throw new Error("Expected type validation to fail");
    } catch (error) {
      expect(error).toBeInstanceOf(McpError);
      expect(error).toMatchObject({ code: "invalid_params" });
    }
    try {
      call("links.list", { nodeId: "unknown" });
      throw new Error("Expected id lookup to fail");
    } catch (error) {
      expect(error).toBeInstanceOf(McpError);
      expect(error).toMatchObject({ code: "not_found" });
      expect((error as Error).message).toContain("nodes.list or search");
    }
  });
});
