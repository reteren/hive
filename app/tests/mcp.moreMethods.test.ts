import { beforeEach, describe, expect, it, vi } from "vitest";

const fileMocks = vi.hoisted(() => ({
  image: vi.fn(),
  audio: vi.fn(),
  video: vi.fn(),
  format: vi.fn(),
  markdown: vi.fn(),
  source: vi.fn(),
  save: vi.fn(),
}));

vi.mock("../src/images/imageActions", async (importOriginal) => ({
  ...await importOriginal<typeof import("../src/images/imageActions")>(),
  importImagePaths: fileMocks.image,
}));
vi.mock("../src/audio/audioActions", async (importOriginal) => ({
  ...await importOriginal<typeof import("../src/audio/audioActions")>(),
  importAudioPaths: fileMocks.audio,
}));
vi.mock("../src/video/import", async (importOriginal) => ({
  ...await importOriginal<typeof import("../src/video/import")>(),
  importVideoPaths: fileMocks.video,
}));
vi.mock("../src/formats/formatActions", async (importOriginal) => ({
  ...await importOriginal<typeof import("../src/formats/formatActions")>(),
  importFormatPaths: fileMocks.format,
}));
vi.mock("../src/formats/textDrop", async (importOriginal) => ({
  ...await importOriginal<typeof import("../src/formats/textDrop")>(),
  importMarkdownPaths: fileMocks.markdown,
}));
vi.mock("../src/source/creation", async (importOriginal) => ({
  ...await importOriginal<typeof import("../src/source/creation")>(),
  createSourceNotes: fileMocks.source,
}));
vi.mock("../src/project/persistence.svelte", async (importOriginal) => ({
  ...await importOriginal<typeof import("../src/project/persistence.svelte")>(),
  flushPendingSave: fileMocks.save,
}));

import "../src/mcp/moreMethods";
import { dispatchMcpRequest } from "../src/mcp/dispatcher";
import { getMcpMethod, McpError } from "../src/mcp/registry";
import { board, replaceBoard } from "../src/model/board.svelte";
import { links, replaceLinks } from "../src/model/links.svelte";
import { zones, replaceZones } from "../src/model/zones.svelte";
import { trash, replaceTrash } from "../src/model/retention.svelte";
import { history, clear as clearHistory, execute, undo } from "../src/history/history.svelte";
import { camera, cameraSettings, viewport } from "../src/board/camera.svelte";
import { project } from "../src/project/project.svelte";
import type { Note } from "../src/model/note";

function makeNote(id: string, x = 0, y = 0, name = id, type: Note["type"] = "note"): Note {
  return { id, type, name, text: "", x, y, width: 20, height: 20, createdAt: 1 };
}

function method(name: string): (params: Record<string, unknown>) => unknown {
  const registered = getMcpMethod(name);
  if (!registered) throw new Error(`Missing method ${name}`);
  return (params) => registered.run(params);
}

async function addImportedNode(kind: Note["type"], center: { x: number; y: number }): Promise<string> {
  const id = `imported-${kind}-${Date.now()}-${Math.random()}`;
  const { addNote } = await import("../src/model/board.svelte");
  addNote({ ...makeNote(id, center.x - 10, center.y - 10, `${kind} file`, kind), height: null });
  return id;
}

describe("MCP links, zones, file import, trash, view, history, and save methods", () => {
  beforeEach(() => {
    clearHistory();
    replaceBoard([makeNote("a", 0, 0, "Alpha"), makeNote("b", 60, 0, "Beta")]);
    replaceLinks([]);
    replaceZones([]);
    replaceTrash([]);
    project.path = "C:\\Project";
    camera.x = 0;
    camera.y = 0;
    camera.zoom = 1;
    cameraSettings.minZoom = 0.05;
    cameraSettings.maxZoom = 8;
    viewport.width = 1000;
    viewport.height = 700;
    fileMocks.image.mockReset().mockImplementation(async (_paths: string[], center: { x: number; y: number }) => {
      await addImportedNode("image", center);
      return true;
    });
    fileMocks.audio.mockReset().mockImplementation(async (_paths: string[], center: { x: number; y: number }) => {
      await addImportedNode("audio", center);
      return true;
    });
    fileMocks.video.mockReset().mockImplementation(async (_paths: string[], center: { x: number; y: number }) => [await addImportedNode("video", center)]);
    fileMocks.format.mockReset().mockImplementation(async (_paths: string[], center: { x: number; y: number }) => {
      await addImportedNode("format", center);
      return true;
    });
    fileMocks.markdown.mockReset().mockImplementation(async (_paths: string[], center: { x: number; y: number }) => {
      await addImportedNode("note", center);
      return true;
    });
    fileMocks.source.mockReset().mockImplementation(async (_paths: string[], center: { x: number; y: number }) => [await addImportedNode("source", center)]);
    fileMocks.save.mockReset().mockResolvedValue(undefined);
  });

  it("creates, updates, and deletes links while preserving app link rules", async () => {
    const created = await method("links.create")({ links: [{ from: "a", to: "b", kind: "weak", shape: "wave" }] }) as { links: Array<{ id: string; fromName: string; toName: string; kind: string }> };
    expect(created.links[0]).toMatchObject({ fromName: "Alpha", toName: "Beta", kind: "weak" });
    const id = created.links[0]!.id;
    await method("links.update")({ updates: [{ id, kind: "strong", shape: "orthogonal" }] });
    expect(links.byId[id]).toMatchObject({ kind: "strong", shape: "orthogonal" });
    await method("links.delete")({ ids: [id] });
    expect(links.byId[id]).toBeUndefined();
    expect(() => method("links.create")({ links: [{ from: "a", to: "a" }] })).toThrow(expect.objectContaining({ code: "invalid_params" }));
  });

  it("records a complete mutating method as one MCP undo entry", async () => {
    await dispatchMcpRequest({ method: "links.create", params: { links: [{ from: "a", to: "b" }] } });
    expect(history.entries).toHaveLength(1);
    expect(history.entries[0]?.label).toBe("MCP: create 1 links");
    undo();
    expect(Object.keys(links.byId)).toHaveLength(0);
    await dispatchMcpRequest({ method: "links.create", params: { links: [{ from: "a", to: "b" }] } });
    expect(method("history.undo")({})).toEqual({ undone: "MCP: create 1 links" });
    expect(Object.keys(links.byId)).toHaveLength(0);
  });

  it("creates zones around notes, updates their shape and color, and deletes them to trash", async () => {
    const created = await method("zones.create")({ name: "Research", color: "#123456", around: { ids: ["a", "b"], padding: 5 } }) as { id: string; name: string; color: string; nodeIds: string[] };
    expect(created).toMatchObject({ name: "Research", color: "#123456" });
    expect(created.nodeIds).toEqual(expect.arrayContaining(["a", "b"]));
    await method("zones.update")({ id: created.id, name: "Evidence", color: "#abcdef", rect: { x: -10, y: -10, width: 110, height: 50 } });
    expect(zones.byId[created.id]).toMatchObject({ name: "Evidence", color: "#abcdef" });
    await method("zones.delete")({ ids: [created.id] });
    expect(zones.byId[created.id]).toBeUndefined();
    expect(trash.entries).toHaveLength(1);
  });

  it("routes a path through the OS-drop importer and returns the placed node", async () => {
    const result = await method("files.import")({ path: "C:\\files\\photo.png", x: 120, y: 240, name: "Portrait" }) as { node: Record<string, unknown> };
    expect(fileMocks.image).toHaveBeenCalledWith(["C:\\files\\photo.png"], { x: 0, y: 0 });
    expect(result.node).toMatchObject({ type: "image", name: "Portrait", x: 120, y: 240 });
    expect(board.notes[result.node.id as string]).toBeDefined();
    const videoResult = await method("files.import")({ path: "C:\\files\\clip.mp4" }) as { node: Record<string, unknown> };
    expect(fileMocks.video).toHaveBeenCalledWith(["C:\\files\\clip.mp4"], { x: 0, y: 0 });
    expect(videoResult.node.type).toBe("video");
  });

  it("restores an entry with its node id and fails before mutation on missing ids", async () => {
    const { moveToTrash } = await import("../src/trash/trashActions.svelte");
    const [entry] = moveToTrash(["a"])!;
    const result = await method("trash.restore")({ ids: [entry!.id] }) as { restored: Array<{ id: string; nodeIds: string[] }> };
    expect(result.restored[0]).toMatchObject({ id: entry!.id, nodeIds: ["a"] });
    expect(board.notes.a).toBeDefined();
    expect(() => method("trash.restore")({ ids: ["missing"] })).toThrow(expect.objectContaining({ code: "not_found" }));
  });

  it("fits the requested board objects in view and rejects undoing a non-MCP action by default", async () => {
    const result = await method("view.focus")({ ids: ["a", "b"] }) as { camera: { x: number; y: number; zoom: number } };
    expect(result.camera.x).toBe(40);
    expect(result.camera.zoom).toBeGreaterThan(0);
    execute({ label: "Create test note", do: () => undefined, undo: () => undefined });
    expect(() => method("history.undo")({})).toThrow(expect.objectContaining({ code: "unsupported" }));
    expect((await method("history.undo")({ onlyIfMcp: false }) as { undone: string }).undone).toBe("Create test note");
  });

  it("saves the open project and reports missing project state", async () => {
    expect(await method("project.save")({})).toEqual({ saved: true });
    expect(fileMocks.save).toHaveBeenCalledOnce();
    project.path = "";
    await expect(method("project.save")({})).rejects.toBeInstanceOf(McpError);
  });
});
