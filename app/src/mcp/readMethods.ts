import packageMetadata from "../../package.json";
import { camera, viewport } from "../board/camera.svelte";
import { PX_PER_UNIT } from "../board/cameraMath";
import { board } from "../model/board.svelte";
import { archive, trash } from "../model/retention.svelte";
import { links } from "../model/links.svelte";
import { zones } from "../model/zones.svelte";
import { project } from "../project/project.svelte";
import { projectNoteFiles } from "../project/index";
import { savedNoteFiles } from "../project/persistence.svelte";
import { selection } from "../selection/selection.svelte";
import { searchNotes, type SearchNote } from "../search/matching";
import { zoneMembers } from "../zones/membership.svelte";
import type { Note, NoteKind } from "../model/note";
import { ME_OBJECT_ID } from "../model/link";
import { hasMeBeacon } from "../beacons/beaconState.svelte";
import { noteBounds } from "../notes/layout.svelte";
import { trashEntrySummary } from "../trash/trash";
import { asParams, McpError, registerMcpMethod } from "./registry";
import { NOTE_KINDS, buildMcpSchema } from "./read/schema";
import { displayPath, fullNode, jsonClone, linkInfo, nodeSummary, type LinkInfo } from "./read/serialize";

const MCP_PROTOCOL_VERSION = 1;
const DEFAULT_NODE_LIMIT = 100;
const MAX_NODE_LIMIT = 500;
const DEFAULT_SEARCH_LIMIT = 20;
const MAX_SEARCH_LIMIT = 100;

interface BBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

function requireProject(): void {
  if (!project.path.trim()) {
    throw new McpError("no_project", "Open a project in hive before reading project data.");
  }
  if (!project.ready) {
    throw new McpError("busy", "The project is still loading. Retry this read request in a moment.");
  }
}

function orderedNotes(): Note[] {
  return board.order.flatMap((id) => board.notes[id] ? [board.notes[id]] : []);
}

function searchNote(note: Note): SearchNote {
  return {
    id: note.id,
    name: note.name,
    text: note.text,
    createdAt: note.createdAt,
    type: note.type,
    task: Boolean(note.task),
  };
}

function parseTypes(value: unknown): Set<NoteKind> | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) {
    throw new McpError("invalid_params", "types must be an array of node type strings.");
  }
  const unknownTypes = value.filter((item) => !NOTE_KINDS.includes(item as NoteKind));
  if (unknownTypes.length > 0) {
    throw new McpError("invalid_params", `Unknown node type '${unknownTypes[0]}'. Use schema to see supported types.`, { types: NOTE_KINDS });
  }
  return new Set(value as NoteKind[]);
}

function parseBBox(value: unknown): BBox | undefined {
  if (value === undefined) return undefined;
  if (!isRecord(value) || !isFiniteNumber(value.x) || !isFiniteNumber(value.y) ||
    !isFiniteNumber(value.width) || !isFiniteNumber(value.height) || value.width < 0 || value.height < 0) {
    throw new McpError("invalid_params", "bbox must contain finite x, y, width, and height values; width and height cannot be negative.");
  }
  return { x: value.x, y: value.y, width: value.width, height: value.height };
}

function parseInteger(value: unknown, field: string, fallback: number, maximum: number): number {
  if (value === undefined) return fallback;
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0 || value > maximum) {
    throw new McpError("invalid_params", `${field} must be an integer from 0 to ${maximum}.`);
  }
  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function noteIntersects(note: Note, bbox: BBox): boolean {
  const bounds = noteBounds(note);
  return bounds.x <= bbox.x + bbox.width && bounds.x + bounds.width >= bbox.x &&
    bounds.y <= bbox.y + bbox.height && bounds.y + bounds.height >= bbox.y;
}

function sortNotes(notes: Note[], sort: "position" | "created" | "name"): Note[] {
  const order = new Map(board.order.map((id, index) => [id, index]));
  return notes.sort((left, right) => {
    if (sort === "name") {
      const byName = left.name.localeCompare(right.name, undefined, { sensitivity: "base" });
      if (byName !== 0) return byName;
    } else if (sort === "created") {
      const first = left.createdAt;
      const second = right.createdAt;
      if (first !== second) {
        if (first === undefined) return 1;
        if (second === undefined) return -1;
        return first - second;
      }
    } else {
      const byY = left.y - right.y;
      if (byY !== 0) return byY;
      const byX = left.x - right.x;
      if (byX !== 0) return byX;
    }
    return (order.get(left.id) ?? Number.MAX_SAFE_INTEGER) - (order.get(right.id) ?? Number.MAX_SAFE_INTEGER);
  });
}

function linkInfosFor(nodeId?: string): LinkInfo[] {
  return Object.values(links.byId)
    .filter((link) => nodeId === undefined || link.from === nodeId || link.to === nodeId)
    .map(linkInfo);
}

function parseStringArray(value: unknown, field: string): string[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) {
    throw new McpError("invalid_params", `${field} must be an array of strings.`);
  }
  return value as string[];
}

registerMcpMethod({
  name: "status",
  mutating: false,
  run: () => {
    const zoom = isFiniteNumber(camera.zoom) && camera.zoom > 0 ? camera.zoom : 1;
    const viewportWidth = viewport.width / (PX_PER_UNIT * zoom);
    const viewportHeight = viewport.height / (PX_PER_UNIT * zoom);
    return {
      appVersion: packageMetadata.version,
      protocol: MCP_PROTOCOL_VERSION,
      project: { name: project.name, root: displayPath(project.path) },
      meBeacon: { id: ME_OBJECT_ID, present: hasMeBeacon() },
      counts: {
        nodes: Object.keys(board.notes).length,
        links: Object.keys(links.byId).length,
        zones: Object.keys(zones.byId).length,
        trash: trash.entries.length,
        archive: archive.entries.length,
      },
      camera: { x: camera.x, y: camera.y, zoom: camera.zoom },
      viewport: {
        x: camera.x - viewportWidth / 2,
        y: camera.y - viewportHeight / 2,
        width: viewportWidth,
        height: viewportHeight,
      },
      selection: [...selection.ids],
    };
  },
});

registerMcpMethod({
  name: "schema",
  mutating: false,
  run: () => buildMcpSchema(hasMeBeacon()),
});

registerMcpMethod({
  name: "nodes.list",
  mutating: false,
  run: (rawParams) => {
    requireProject();
    const params = asParams(rawParams);
    const types = parseTypes(params.types);
    const bbox = parseBBox(params.bbox);
    const query = params.query;
    if (query !== undefined && typeof query !== "string") {
      throw new McpError("invalid_params", "query must be a string.");
    }
    const task = params.task;
    if (task !== undefined && task !== "open" && task !== "done" && task !== "any" && task !== "none") {
      throw new McpError("invalid_params", "task must be 'open', 'done', 'any', or 'none'.");
    }
    const sort = params.sort ?? "position";
    if (sort !== "position" && sort !== "created" && sort !== "name") {
      throw new McpError("invalid_params", "sort must be 'position', 'created', or 'name'.");
    }
    const limit = parseInteger(params.limit, "limit", DEFAULT_NODE_LIMIT, MAX_NODE_LIMIT);
    const offset = parseInteger(params.offset, "offset", 0, Number.MAX_SAFE_INTEGER);
    const zoneId = params.zoneId;
    if (zoneId !== undefined && typeof zoneId !== "string") {
      throw new McpError("invalid_params", "zoneId must be a zone id string.");
    }
    if (typeof zoneId === "string" && !zones.byId[zoneId]) {
      throw new McpError("not_found", `Zone '${zoneId}' not found. Use zones.list to get zone ids.`);
    }
    const linkedTo = params.linkedTo;
    if (linkedTo !== undefined && typeof linkedTo !== "string") {
      throw new McpError("invalid_params", "linkedTo must be a node id string.");
    }
    if (typeof linkedTo === "string" && (linkedTo === ME_OBJECT_ID ? !hasMeBeacon() : !board.notes[linkedTo])) {
      throw new McpError("not_found", `Node '${linkedTo}' not found. Use nodes.list or search to get ids.`);
    }

    let result = orderedNotes().filter((note) => {
      if (types && !types.has(note.type)) return false;
      if (typeof zoneId === "string" && note.zoneId !== zoneId) return false;
      if (task === "open" && (!note.task || note.task.done)) return false;
      if (task === "done" && note.task?.done !== true) return false;
      if (task === "any" && !note.task) return false;
      if (task === "none" && note.task) return false;
      if (bbox && !noteIntersects(note, bbox)) return false;
      if (typeof linkedTo === "string" && !Object.values(links.byId).some((link) =>
        (link.from === note.id && link.to === linkedTo) || (link.to === note.id && link.from === linkedTo))) return false;
      return true;
    });
    if (typeof query === "string" && query.trim()) {
      const matchedIds = new Set(searchNotes(query, result.map(searchNote), board.order).map((item) => item.noteId));
      result = result.filter((note) => matchedIds.has(note.id));
    }
    const sorted = sortNotes(result, sort);
    return {
      total: sorted.length,
      nodes: sorted.slice(offset, offset + limit).map(nodeSummary),
    };
  },
});

registerMcpMethod({
  name: "nodes.get",
  mutating: false,
  run: (rawParams) => {
    requireProject();
    const params = asParams(rawParams);
    const ids = parseStringArray(params.ids, "ids");
    const names = parseStringArray(params.names, "names");
    if (ids === undefined && names === undefined) {
      throw new McpError("invalid_params", "Provide ids or names. Use nodes.list or search to discover nodes.");
    }
    if ((ids?.length ?? 0) + (names?.length ?? 0) > 50) {
      throw new McpError("invalid_params", "nodes.get accepts at most 50 ids and names per call.");
    }

    const notes = orderedNotes();
    const filesById = projectNoteFiles(notes, savedNoteFiles());
    const found = new Map<string, Note>();
    const missing: string[] = [];
    for (const id of ids ?? []) {
      const note = board.notes[id];
      if (note) found.set(note.id, note);
      else missing.push(id);
    }
    for (const name of names ?? []) {
      const exact = notes.filter((note) => note.name === name);
      const matches = exact.length > 0
        ? exact
        : notes.filter((note) => note.name.toLowerCase() === name.toLowerCase());
      if (matches.length === 0) missing.push(name);
      else for (const note of matches) found.set(note.id, note);
    }
    return {
      nodes: [...found.values()].map((note) => fullNode(note, filesById.get(note.id) ?? `${note.name}.md`)),
      missing: [...new Set(missing)],
    };
  },
});

registerMcpMethod({
  name: "search",
  mutating: false,
  run: (rawParams) => {
    requireProject();
    const params = asParams(rawParams);
    if (typeof params.query !== "string") {
      throw new McpError("invalid_params", "query must be a string. Provide the text to search for.");
    }
    const types = parseTypes(params.types);
    const limit = parseInteger(params.limit, "limit", DEFAULT_SEARCH_LIMIT, MAX_SEARCH_LIMIT);
    const notes = orderedNotes().filter((note) => !types || types.has(note.type));
    const results = searchNotes(params.query, notes.map(searchNote), board.order).map((result) => ({
      id: result.noteId,
      name: result.noteName,
      type: result.objectKind ?? board.notes[result.noteId]?.type ?? "note",
      matchedIn: result.kind,
      snippet: result.snippet,
    }));
    return { results: results.slice(0, limit) };
  },
});

registerMcpMethod({
  name: "links.list",
  mutating: false,
  run: (rawParams) => {
    requireProject();
    const params = asParams(rawParams);
    let nodeId: string | undefined;
    if (params.nodeId !== undefined) {
      if (typeof params.nodeId !== "string") throw new McpError("invalid_params", "nodeId must be a node id string.");
      nodeId = params.nodeId;
      if (nodeId === ME_OBJECT_ID ? !hasMeBeacon() : !board.notes[nodeId]) {
        throw new McpError("not_found", `Node '${nodeId}' not found. Use nodes.list or search to get ids.`);
      }
    }
    return { links: linkInfosFor(nodeId) };
  },
});

registerMcpMethod({
  name: "zones.list",
  mutating: false,
  run: () => {
    requireProject();
    const result = zones.order.flatMap((id) => {
      const zone = zones.byId[id];
      if (!zone) return [];
      return [{ ...jsonClone(zone), nodeIds: zoneMembers(id) }];
    });
    return { zones: result };
  },
});

registerMcpMethod({
  name: "trash.list",
  mutating: false,
  run: () => {
    requireProject();
    return {
      entries: [...trash.entries].reverse().map((entry) => {
        const objectCount = entry.notes.length + entry.zones.length;
        const type = objectCount !== 1 ? "objects" : entry.notes[0]?.type ?? "zone";
        return { id: entry.id, name: trashEntrySummary(entry), type, deletedAt: entry.deletedAt };
      }),
    };
  },
});

registerMcpMethod({
  name: "archive.list",
  mutating: false,
  run: () => {
    requireProject();
    return {
      entries: [...archive.entries].reverse().map((entry) => ({
        id: entry.id,
        name: entry.note.name,
        type: entry.note.type,
        deletedAt: entry.archivedAt,
      })),
    };
  },
});
