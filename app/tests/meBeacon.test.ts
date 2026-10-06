import { afterEach, beforeEach, describe, expect, it } from "vitest";
import "../src/board/cameraCommands";
import "../src/mcp/readMethods";
import "../src/mcp/viewMethods";
import { camera } from "../src/board/camera.svelte";
import { beaconState, hasMeBeacon, resetBeaconViewState } from "../src/beacons/beaconState.svelte";
import { allBeacons, isBeacon } from "../src/beacons/focus.svelte";
import { linkRefusalReason } from "../src/links/rules";
import { getCommands } from "../src/commands/registry.svelte";
import { clear, redo, undo } from "../src/history/history.svelte";
import { links, replaceLinks } from "../src/model/links.svelte";
import { board, replaceBoard } from "../src/model/board.svelte";
import { replaceZones } from "../src/model/zones.svelte";
import { archive, replaceArchive, replaceTrash, trash } from "../src/model/retention.svelte";
import type { Note } from "../src/model/note";
import { project } from "../src/project/project.svelte";
import { parseProjectIndex, serializeProjectIndex } from "../src/project/index";
import { deletePermanently, deleteMeBeacon, restoreTrashEntry, resetTrashHistoryInvalidators } from "../src/trash/trashActions.svelte";
import { getMcpMethod, McpError } from "../src/mcp/registry";
import { scopeExistsIn } from "../src/scope/scopeLogic";
import { zoneOf } from "../src/zones/membership.svelte";
import { rectContour } from "../src/model/zone";

function note(): Note {
  return { id: "target", type: "note", name: "Target", text: "", x: 50, y: 50, width: 30, height: 20 };
}

function call<T>(name: string, params: unknown = {}): T {
  const method = getMcpMethod(name);
  if (!method) throw new Error(`Missing MCP method ${name}`);
  return method.run(params as Record<string, unknown>) as T;
}

beforeEach(() => {
  clear();
  resetTrashHistoryInvalidators();
  resetBeaconViewState();
  replaceBoard([note()]);
  replaceLinks([{ id: "me-target", from: "me", to: "target", kind: "strong", shape: "base" }]);
  replaceZones([]);
  replaceTrash([]);
  replaceArchive([]);
  project.path = "C:/projects/sample";
  project.name = "Sample";
  project.ready = true;
  camera.x = 40;
  camera.y = 70;
  camera.zoom = 2;
});

afterEach(() => {
  clear();
  resetTrashHistoryInvalidators();
  resetBeaconViewState();
  replaceBoard([]);
  replaceLinks([]);
  replaceZones([]);
  replaceTrash([]);
  replaceArchive([]);
});

describe("ME beacon lifecycle", () => {
  it("moves ME and its links to persistent trash with one Undo step", () => {
    const entry = deleteMeBeacon();
    expect(entry).toMatchObject({ meBeacon: true, links: [{ id: "me-target" }] });
    expect(hasMeBeacon()).toBe(false);
    expect(isBeacon("me")).toBe(false);
    expect(allBeacons()).toEqual([]);
    expect(links.byId["me-target"]).toBeUndefined();
    expect(trash.entries[0]).toMatchObject({ meBeacon: true, notes: [], zones: [] });

    const parsed = parseProjectIndex(serializeProjectIndex(
      [board.notes.target!], undefined, Object.values(links.byId), undefined, undefined,
      beaconState.marked, undefined, archive.entries, trash.entries, undefined, beaconState.meDeleted,
    ));
    expect(parsed.meDeleted).toBe(true);
    expect(parsed.trash[0]).toMatchObject({ meBeacon: true, links: [{ id: "me-target" }] });

    undo();
    expect(hasMeBeacon()).toBe(true);
    expect(links.byId["me-target"]).toBeDefined();
    expect(trash.entries).toEqual([]);
    redo();
    expect(hasMeBeacon()).toBe(false);
    expect(links.byId["me-target"]).toBeUndefined();
  });

  it("restores a trashed ME and its valid links, while Undo returns it to trash", () => {
    const entry = deleteMeBeacon()!;
    const restored = restoreTrashEntry(entry.id);
    expect(restored?.linksRestored.map(({ id }) => id)).toEqual(["me-target"]);
    expect(hasMeBeacon()).toBe(true);
    expect(links.byId["me-target"]).toBeDefined();
    expect(trash.entries).toEqual([]);

    undo();
    expect(hasMeBeacon()).toBe(false);
    expect(links.byId["me-target"]).toBeUndefined();
    expect(trash.entries).toHaveLength(1);
  });

  it("keeps ME absent after its trash entry is permanently purged", () => {
    const entry = deleteMeBeacon()!;
    deletePermanently(entry.id);
    undo();
    redo();
    expect(hasMeBeacon()).toBe(false);
    expect(trash.entries).toEqual([]);
  });

  it("keeps legacy and new projects initialized with ME, and sends Space to home without beacons", () => {
    expect(parseProjectIndex(JSON.stringify({ version: 3, notes: [] })).meDeleted).toBe(false);
    expect(hasMeBeacon()).toBe(true);
    beaconState.meDeleted = true;
    camera.x = 125;
    camera.y = -82;
    camera.zoom = 2.5;
    getCommands().find((command) => command.id === "view.nextMarkedBeacon")?.run();
    expect(camera).toMatchObject({ x: 0, y: 0, zoom: 1 });
  });

  it("removes ME from link, scope and zone lookups after deletion", () => {
    replaceZones([{
      id: "home", name: "Home", color: "#608ac1",
      parts: [rectContour(-5, -5, 10, 10)], holes: [],
    }]);
    expect(zoneOf("me")).toBe("home");
    expect(scopeExistsIn({ kind: "beacon", id: "me" }, {
      notes: {}, zones: {}, zoneMembers: () => [], beaconDescendants: () => new Set(), mePresent: false,
    })).toBe(false);
    beaconState.meDeleted = true;
    expect(zoneOf("me")).toBeNull();
    expect(linkRefusalReason("me", "target", "strong", [])).toBe("ME beacon has been deleted.");
  });
});

describe("ME-aware MCP reads", () => {
  it("reports presence in status, overview and schema, and rejects deleted ME IDs", () => {
    const status = call<{ meBeacon: { id: string; present: boolean } }>("status");
    const overview = call<{ meBeacon: { id: string; present: boolean }; bounds: { x: number; y: number; width: number; height: number } | null }>("board.overview");
    const schema = call<{ virtualObjects: { meBeacon: { id: string; present: boolean; deletable: boolean } } }>("schema");
    expect(status.meBeacon).toEqual({ id: "me", present: true });
    expect(overview.meBeacon).toEqual({ id: "me", present: true });
    expect(overview.bounds?.x).toBeLessThanOrEqual(-3.6);
    expect(schema.virtualObjects.meBeacon).toMatchObject({ id: "me", present: true, deletable: true });

    beaconState.meDeleted = true;
    expect(call<{ meBeacon: { present: boolean } }>("status").meBeacon.present).toBe(false);
    expect(call<{ meBeacon: { present: boolean }; bounds: { x: number; y: number; width: number; height: number } | null }>("board.overview")).toMatchObject({ meBeacon: { present: false } });
    expect(call<{ virtualObjects: { meBeacon: { present: boolean } } }>("schema").virtualObjects.meBeacon.present).toBe(false);
    expect(() => call("links.list", { nodeId: "me" })).toThrow(McpError);
  });
});
