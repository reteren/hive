import { beforeEach, describe, expect, it } from "vitest";
import "../src/mcp/viewMethods";
import { getMcpMethod, McpError } from "../src/mcp/registry";
import { clusterNodes } from "../src/mcp/view/clusters";
import { board, replaceBoard } from "../src/model/board.svelte";
import { replaceLinks } from "../src/model/links.svelte";
import { archive, replaceArchive, replaceTrash, trash } from "../src/model/retention.svelte";
import { replaceZones, zones } from "../src/model/zones.svelte";
import type { Note } from "../src/model/note";
import { project } from "../src/project/project.svelte";
import { selection } from "../src/selection/selection.svelte";
import { camera } from "../src/board/camera.svelte";
import { rectContour } from "../src/model/zone";

function note(id: string, name: string, x: number, patch: Partial<Note> = {}): Note {
  return { id, type: "note", name, text: "", x, y: 0, width: 10, height: 10, ...patch };
}

function overview(): unknown {
  const method = getMcpMethod("board.overview");
  if (!method) throw new Error("Missing board.overview");
  return method.run({}) as never;
}

beforeEach(() => {
  replaceBoard([
    note("a", "Alpha", 0, { text: "alpha".repeat(8), createdAt: 10, task: { done: false, doneAt: null } }),
    note("b", "Beta", 24, { text: "beta", createdAt: 30, task: { done: true, doneAt: 31 } }),
    note("c", "Gamma", 100, { text: "gamma".repeat(4), createdAt: 20, type: "image", image: { file: "anim.gif", mime: "image/gif", size: 100, naturalWidth: 20, naturalHeight: 10 } }),
  ]);
  replaceLinks([
    { id: "ab", from: "a", to: "b", kind: "strong", shape: "base" },
    { id: "ac", from: "a", to: "c", kind: "weak", shape: "wave" },
    { id: "missing", from: "a", to: "missing", kind: "weak", shape: "base" },
  ]);
  replaceZones([{ id: "z1", name: "Zone", color: "#608ac1", parts: [rectContour(-20, -20, 100, 60)], holes: [] }]);
  replaceTrash([]);
  replaceArchive([]);
  project.name = "Sample";
  project.path = "C:/projects/sample";
  project.ready = true;
  selection.ids = ["b"];
  camera.x = 12;
  camera.y = 34;
  camera.zoom = 1.5;
});

describe("MCP board overview", () => {
  it("clusters links and near rectangles, labels each group by its highest-degree node", () => {
    const notes = [note("a", "Alpha", 0), note("b", "Beta", 24), note("c", "Gamma", 100), note("d", "Delta", 140)];
    const clusters = clusterNodes(notes, (item) => ({ x: item.x, y: item.y, width: item.width, height: item.height ?? 10 }), [
      { from: "a", to: "b" },
      { from: "b", to: "c" },
      { from: "c", to: "not-a-node" },
    ]);
    expect(clusters).toEqual([
      { bbox: { x: 0, y: 0, width: 110, height: 10 }, nodeIds: ["a", "b", "c"], label: "Beta" },
      { bbox: { x: 140, y: 0, width: 10, height: 10 }, nodeIds: ["d"], label: "Delta" },
    ]);
  });

  it("returns a compact project map without changing board, selection, or camera", () => {
    const orderBefore = [...board.order];
    const cameraBefore = { ...camera };
    const selectionBefore = [...selection.ids];
    const result = overview() as {
      project: { name: string; root: string };
      counts: { nodes: number; links: number; zones: number; trash: number; archive: number };
      bounds: { x: number; y: number; width: number; height: number };
      zones: Array<{ id: string; name: string; bbox: { x: number; y: number; width: number; height: number }; nodeIds: string[] }>;
      clusters: Array<{ nodeIds: string[]; label: string }>;
      kinds: Record<string, number>;
      media: Record<string, number>;
      tasks: { open: number; done: number };
      recent: Array<{ id: string }>;
      largestTexts: Array<{ id: string; chars: number }>;
    };
    expect(result).toMatchObject({
      project: { name: "Sample", root: "C:/projects/sample" },
      counts: { nodes: 3, links: 3, zones: 1, trash: 0, archive: 0 },
      bounds: { x: -20, y: -20, width: 130, height: 60 },
      zones: [{ id: "z1", name: "Zone", bbox: { x: -20, y: -20, width: 100, height: 60 } }],
      kinds: { note: 2, image: 1 },
      media: { images: 1, gifs: 1 },
      tasks: { open: 1, done: 1 },
      recent: [{ id: "b" }, { id: "c" }, { id: "a" }],
      largestTexts: [{ id: "a", chars: 40 }, { id: "c", chars: 20 }, { id: "b", chars: 4 }],
    });
    expect(result.clusters).toEqual([{ bbox: { x: 0, y: 0, width: 110, height: 10 }, nodeIds: ["a", "b", "c"], label: "Alpha" }]);
    expect(result.zones[0].nodeIds).toContain("a");
    expect(board.order).toEqual(orderBefore);
    expect(selection.ids).toEqual(selectionBefore);
    expect(camera).toEqual(cameraBefore);
  });

  it("validates the no-project and unexpected-parameter cases", () => {
    const method = getMcpMethod("board.overview");
    if (!method) throw new Error("Missing board.overview");
    project.path = "";
    expect(() => method.run({})).toThrowError(McpError);
    project.path = "C:/projects/sample";
    expect(() => method.run({ extra: true })).toThrowError(McpError);
  });

  it("rejects invalid capture parameters before calling the native preview command", async () => {
    const method = getMcpMethod("view.capture");
    if (!method) throw new Error("Missing view.capture");
    await expect(method.run({ maxPx: 200 })).rejects.toThrowError(McpError);
    await expect(method.run({ bbox: { x: 0, y: 0, width: 10, height: 10, extra: true } })).rejects.toThrowError(McpError);
    await expect(method.run({ ids: ["missing"] })).rejects.toThrowError(McpError);
  });
});
