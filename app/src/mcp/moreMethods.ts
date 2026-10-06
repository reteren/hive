import { board, updateNote } from "../model/board.svelte";
import { canLink, linkRefusalReason as currentLinkRefusalReason, links } from "../model/links.svelte";
import { ME_OBJECT_ID, type Link, type LineShape } from "../model/link";
import { hasMeBeacon } from "../beacons/beaconState.svelte";
import { newId, BEACON_SIZE } from "../model/note";
import { zones } from "../model/zones.svelte";
import { trash } from "../model/retention.svelte";
import { execute, history, undo } from "../history/history.svelte";
import { McpError, registerMcpMethod, asParams } from "./registry";
import { changeLinkShape, createBoardLink, unlink } from "../links/operations";
import { effectiveLinkKind, linkRefusalReason } from "../links/rules";
import { createZone, deleteZone, recolorZone, renameZone, ZONE_COLORS } from "../zones/commands";
import { MIN_ZONE_SIZE, rectangleOverlapsZones } from "../zones/geometry";
import { addZone, updateZone } from "../model/zones.svelte";
import { rectContour, type Zone, type ZoneBounds } from "../model/zone";
import { zoneMembers } from "../zones/membership.svelte";
import { noteBounds } from "../notes/layout.svelte";
import { notePositionAt, randomFreeNoteCenter } from "../notes/creationPosition";
import { uniqueName } from "../notes/naming";
import { boardDropKindForPath } from "../attachments/service";
import { importImagePaths } from "../images/imageActions";
import { importAudioPaths } from "../audio/audioActions";
import { importVideoPaths } from "../video/import";
import { createSourceNotes } from "../source/creation";
import { importFormatPaths } from "../formats/formatActions";
import { importMarkdownPaths } from "../formats/textDrop";
import { camera, cameraSettings, ME_POSITION, refreshPointerWorld, viewport } from "../board/camera.svelte";
import { project } from "../project/project.svelte";
import { flushPendingSave } from "../project/persistence.svelte";
import { previewRestore, restoreTrashEntry } from "../trash/trashActions.svelte";

type RecordValue = Record<string, unknown>;
type LinkInfo = Pick<Link, "id" | "from" | "to" | "kind" | "shape"> & { fromName: string; toName: string };

const LINK_KINDS = ["strong", "weak"] as const;
const LINE_SHAPES: readonly LineShape[] = ["base", "orthogonal", "zigzag", "wave"];

registerMcpMethod({
  name: "links.create",
  mutating: true,
  label: (params) => `create ${Array.isArray(asParams(params).links) ? (asParams(params).links as unknown[]).length : 0} links`,
  run: (value) => createLinks(asParams(value)),
});

registerMcpMethod({
  name: "links.update",
  mutating: true,
  label: (params) => `update ${Array.isArray(asParams(params).updates) ? (asParams(params).updates as unknown[]).length : 0} links`,
  run: (value) => updateLinks(asParams(value)),
});

registerMcpMethod({
  name: "links.delete",
  mutating: true,
  label: (params) => `delete ${Array.isArray(asParams(params).ids) ? (asParams(params).ids as unknown[]).length : 0} links`,
  run: (value) => deleteLinks(asParams(value)),
});

registerMcpMethod({
  name: "zones.create",
  mutating: true,
  label: () => "create zone",
  run: (value) => createMcpZone(asParams(value)),
});

registerMcpMethod({
  name: "zones.update",
  mutating: true,
  label: () => "update zone",
  run: (value) => updateMcpZone(asParams(value)),
});

registerMcpMethod({
  name: "zones.delete",
  mutating: true,
  label: (params) => `delete ${Array.isArray(asParams(params).ids) ? (asParams(params).ids as unknown[]).length : 0} zones`,
  run: (value) => deleteZones(asParams(value)),
});

registerMcpMethod({
  name: "files.import",
  mutating: true,
  label: () => "import file",
  run: (value) => importFile(asParams(value)),
});

registerMcpMethod({
  name: "trash.restore",
  mutating: true,
  label: (params) => `restore ${Array.isArray(asParams(params).ids) ? (asParams(params).ids as unknown[]).length : 0} trash entries`,
  run: (value) => restoreTrash(asParams(value)),
});

registerMcpMethod({
  name: "view.focus",
  mutating: false,
  run: (value) => focusView(asParams(value)),
});

registerMcpMethod({
  name: "history.undo",
  mutating: false,
  run: (value) => undoHistory(asParams(value)),
});

registerMcpMethod({
  name: "project.save",
  mutating: false,
  run: () => saveProject(),
});

function createLinks(params: RecordValue): { links: LinkInfo[] } {
  assertKeys(params, ["links"], "links.create");
  const specs = array(params.links, "links", true).map((entry, index) => {
    const spec = record(entry, `links[${index}]`);
    assertKeys(spec, ["from", "to", "kind", "shape"], `links[${index}]`);
    const from = string(spec.from, `links[${index}].from`);
    const to = string(spec.to, `links[${index}].to`);
    const kind = enumValue(spec.kind, LINK_KINDS, `links[${index}].kind`, "strong");
    const shape = enumValue(spec.shape, LINE_SHAPES, `links[${index}].shape`, "base");
    return { from, to, kind, shape };
  });

  const simulated: Pick<Link, "from" | "to" | "kind">[] = Object.values(links.byId)
    .map(({ from, to, kind }) => ({ from, to, kind }));
  const prepared = specs.map((spec, index) => {
    if (spec.from === ME_OBJECT_ID ? !hasMeBeacon() : !board.notes[spec.from]) throw notFound(`Source node '${spec.from}'`, "Use nodes.list or search to get valid ids.");
    if (!board.notes[spec.to]) throw notFound(`Target node '${spec.to}'`, "Use nodes.list or search to get valid ids.");
    const kind = effectiveLinkKind(spec.from, spec.to, spec.kind);
    const reason = linkRefusalReason(spec.from, spec.to, kind, simulated) ??
      (!canLink(spec.from, spec.to, kind) ? currentLinkRefusalReason(spec.from, spec.to, kind) ?? "Hive refused this link." : null);
    if (reason) {
      throw new McpError("invalid_params", reason ?? "This link is not allowed. Check the link rules and existing links.", { index, reason });
    }
    simulated.push({ from: spec.from, to: spec.to, kind });
    return { ...spec, kind, id: newId() } satisfies Link;
  });

  for (const link of prepared) {
    if (!createBoardLink(link)) {
      throw new McpError("invalid_params", "Hive refused this link. Check that both nodes still exist and that the pair is allowed.");
    }
  }
  return { links: prepared.map(linkInfo) };
}

function updateLinks(params: RecordValue): { updated: LinkInfo[] } {
  assertKeys(params, ["updates"], "links.update");
  const updates = array(params.updates, "updates", true).map((entry, index) => {
    const spec = record(entry, `updates[${index}]`);
    assertKeys(spec, ["id", "kind", "shape"], `updates[${index}]`);
    const id = string(spec.id, `updates[${index}].id`);
    if (spec.kind === undefined && spec.shape === undefined) invalid(`updates[${index}]`, "provide kind and/or shape");
    return {
      id,
      ...(spec.kind === undefined ? {} : { kind: enumValue(spec.kind, LINK_KINDS, `updates[${index}].kind`) }),
      ...(spec.shape === undefined ? {} : { shape: enumValue(spec.shape, LINE_SHAPES, `updates[${index}].shape`) }),
    };
  });
  assertUnique(updates.map(({ id }) => id), "updates[].id");
  const changed = updates.map((update) => {
    const before = links.byId[update.id];
    if (!before) throw notFound(`Link '${update.id}'`, "Use links.list to get valid link ids.");
    const requestedKind = update.kind ?? before.kind;
    const kind = effectiveLinkKind(before.from, before.to, requestedKind);
    return {
      before: { ...before },
      after: { ...before, kind, shape: update.shape ?? before.shape },
    };
  });
  const finalById = new Map(Object.values(links.byId).map((link) => [link.id, { ...link }]));
  for (const { after } of changed) finalById.set(after.id, after);
  for (const { after } of changed) {
    const simulated = [...finalById.values()]
      .filter((candidate) => candidate.id !== after.id)
      .map((candidate) => ({ from: candidate.from, to: candidate.to, kind: candidate.kind }));
    const reason = linkRefusalReason(after.from, after.to, after.kind, simulated);
    if (reason) throw new McpError("invalid_params", reason, { id: after.id, reason });
  }
  const actual = changed.filter(({ before, after }) => before.kind !== after.kind || before.shape !== after.shape);
  if (actual.length > 0) {
    const kindChanges = actual.filter(({ before, after }) => before.kind !== after.kind);
    const shapeOnlyChanges = actual.filter(({ before, after }) => before.kind === after.kind && before.shape !== after.shape);
    for (const { before } of kindChanges) {
      if (!unlink(before.id)) throw new McpError("internal", `Hive could not update link '${before.id}'. Retry the request.`);
    }
    for (const { after } of kindChanges) {
      if (!createBoardLink(after)) throw new McpError("invalid_params", `Hive refused the updated link '${after.id}'. Check its endpoints and link rules.`);
    }
    for (const { after } of shapeOnlyChanges) {
      if (!changeLinkShape(after.id, after.shape)) throw new McpError("internal", `Hive could not update link shape '${after.id}'. Retry the request.`);
    }
  }
  return { updated: changed.map(({ after }) => linkInfo(after)) };
}

function deleteLinks(params: RecordValue): { deleted: string[] } {
  assertKeys(params, ["ids"], "links.delete");
  const ids = uniqueStrings(params.ids, "ids");
  for (const id of ids) if (!links.byId[id]) throw notFound(`Link '${id}'`, "Use links.list to get valid link ids.");
  for (const id of ids) {
    if (!unlink(id)) throw new McpError("internal", `Hive could not delete link '${id}'. Retry the request.`);
  }
  return { deleted: ids };
}

function createMcpZone(params: RecordValue): ZoneInfo {
  assertKeys(params, ["name", "color", "rect", "around"], "zones.create");
  if ((params.rect === undefined) === (params.around === undefined)) invalid("rect/around", "provide exactly one of rect or around");
  const requestedName = params.name === undefined ? undefined : nonEmptyString(params.name, "name");
  const color = params.color === undefined ? undefined : zoneColor(params.color, "color");
  const bounds = params.rect === undefined ? boundsAround(params.around) : parseRect(params.rect, "rect");
  validateZoneRect(bounds, Object.values(zones.byId));

  let name: string | undefined;
  if (requestedName !== undefined) {
    name = uniqueName(requestedName, []);
    if (uniqueName(name, Object.values(zones.byId).map((zone) => zone.name)) !== name) {
      throw new McpError("name_conflict", `Zone name '${name}' is already in use. Choose a different name and retry.`);
    }
  }
  const created = createZone(bounds);
  if (!created) throw new McpError("invalid_params", "This rectangle is too small or overlaps another zone. Choose a non-overlapping rectangle at least 30 units wide and high.");
  if (name !== undefined) renameZone(created.id, name);
  if (color !== undefined) recolorZone(created.id, color);
  const zone = zones.byId[created.id];
  if (!zone) throw new McpError("internal", "Hive created a zone but it could not be read back.");
  return zoneInfo(zone);
}

function updateMcpZone(params: RecordValue): ZoneInfo {
  assertKeys(params, ["id", "name", "color", "rect"], "zones.update");
  const id = string(params.id, "id");
  const zone = zones.byId[id];
  if (!zone) throw notFound(`Zone '${id}'`, "Use zones.list to get valid zone ids.");
  const hasName = params.name !== undefined;
  const hasColor = params.color !== undefined;
  const hasRect = params.rect !== undefined;
  if (!hasName && !hasColor && !hasRect) invalid("updates", "provide at least one of name, color, or rect");

  let name: string | undefined;
  if (hasName) {
    const requested = uniqueName(nonEmptyString(params.name, "name"), []);
    name = uniqueName(requested, Object.values(zones.byId).filter((other) => other.id !== id).map((other) => other.name));
    if (name !== requested) throw new McpError("name_conflict", `Zone name '${requested}' is already in use. Choose a different name and retry.`);
  }
  const color = hasColor ? zoneColor(params.color, "color") : undefined;
  const rect = hasRect ? parseRect(params.rect, "rect") : undefined;
  if (rect) validateZoneRect(rect, Object.values(zones.byId).filter((other) => other.id !== id));

  if (name !== undefined && name !== zone.name) renameZone(id, name);
  if (color !== undefined && color.toLowerCase() !== zone.color.toLowerCase()) recolorZone(id, color);
  if (rect) setZoneRect(zone, rect);
  return zoneInfo(zone);
}

function deleteZones(params: RecordValue): { deleted: string[] } {
  assertKeys(params, ["ids"], "zones.delete");
  const ids = uniqueStrings(params.ids, "ids");
  for (const id of ids) if (!zones.byId[id]) throw notFound(`Zone '${id}'`, "Use zones.list to get valid zone ids.");
  for (const id of ids) {
    if (!deleteZone(id)) throw new McpError("internal", `Hive could not delete zone '${id}'. Retry the request.`);
  }
  return { deleted: ids };
}

function setZoneRect(zone: Zone, bounds: ZoneBounds): void {
  const before = copyZone(zone);
  const nextParts = [rectContour(bounds.x, bounds.y, bounds.width, bounds.height)];
  execute({
    label: "Resize zone",
    target: zone.name,
    do: () => updateZone(zone.id, { parts: nextParts, holes: [] }),
    undo: () => updateZone(zone.id, { parts: before.parts, holes: before.holes }),
  });
}

interface ZoneInfo extends Zone { nodeIds: string[] }

function zoneInfo(zone: Zone): ZoneInfo {
  return { ...copyZone(zone), nodeIds: zoneMembers(zone.id) };
}

function copyZone(zone: Zone): Zone {
  return {
    ...zone,
    parts: zone.parts.map((part) => part.map((point) => ({ ...point }))),
    holes: zone.holes.map((hole) => hole.map((point) => ({ ...point }))),
  };
}

function boundsAround(value: unknown): ZoneBounds {
  const around = record(value, "around");
  assertKeys(around, ["ids", "padding"], "around");
  const ids = uniqueStrings(around.ids, "around.ids");
  const padding = around.padding === undefined ? 20 : nonNegativeNumber(around.padding, "around.padding");
  const bounds = ids.map((id): ZoneBounds => {
    if (id === ME_OBJECT_ID) {
      if (!hasMeBeacon()) throw notFound(`Node '${id}'`, "Use nodes.list or search to get valid ids.");
      return { x: ME_POSITION.x - BEACON_SIZE / 2, y: ME_POSITION.y - BEACON_SIZE / 2, width: BEACON_SIZE, height: BEACON_SIZE };
    }
    const note = board.notes[id];
    if (!note) throw notFound(`Node '${id}'`, "Use nodes.list or search to get valid ids.");
    return noteBounds(note);
  });
  return padBounds(unionBounds(bounds), padding);
}

function validateZoneRect(bounds: ZoneBounds, existing: readonly Zone[]): void {
  if (bounds.width < MIN_ZONE_SIZE || bounds.height < MIN_ZONE_SIZE) {
    throw new McpError("invalid_params", `Zone width and height must each be at least ${MIN_ZONE_SIZE} units.`);
  }
  if (rectangleOverlapsZones(bounds, existing)) {
    throw new McpError("invalid_params", "This rectangle overlaps an existing zone. Choose a non-overlapping rectangle.");
  }
}

function parseRect(value: unknown, field: string): ZoneBounds {
  const input = record(value, field);
  assertKeys(input, ["x", "y", "width", "height"], field);
  const bounds = {
    x: finiteNumber(input.x, `${field}.x`),
    y: finiteNumber(input.y, `${field}.y`),
    width: positiveNumber(input.width, `${field}.width`),
    height: positiveNumber(input.height, `${field}.height`),
  };
  return bounds;
}

function zoneColor(value: unknown, field: string): string {
  const color = string(value, field);
  if (!/^#[0-9a-f]{6}$/i.test(color)) invalid(field, "use a six-digit hex color such as #608ac1");
  return color.toLowerCase();
}

function parseNearTarget(value: unknown): { bounds: ZoneBounds; side: "right" | "left" | "below" | "above"; gap: number } | null {
  if (value === undefined) return null;
  const near = record(value, "near");
  assertKeys(near, ["node", "side", "gap"], "near");
  const id = string(near.node, "near.node");
  const side = enumValue(near.side, ["right", "left", "below", "above"] as const, "near.side", "right");
  const gap = near.gap === undefined ? 20 : nonNegativeNumber(near.gap, "near.gap");
  if (id === ME_OBJECT_ID) {
    if (!hasMeBeacon()) throw notFound(`Node '${id}'`, "Use nodes.list or search to get valid ids.");
    return { bounds: { x: ME_POSITION.x - BEACON_SIZE / 2, y: ME_POSITION.y - BEACON_SIZE / 2, width: BEACON_SIZE, height: BEACON_SIZE }, side, gap };
  }
  const note = board.notes[id];
  if (!note) throw notFound(`Node '${id}'`, "Use nodes.list or search to get valid ids.");
  return { bounds: noteBounds(note), side, gap };
}

/**
 * Import pipelines drop every file at the same centre; for MCP calls without x/y/near move the new
 * node to the nearest free spot so consecutive imports never stack on top of each other.
 */
function freeSpotFor(id: string, bounds: { width: number; height: number }, center: { x: number; y: number }): { x: number; y: number } {
  const obstacles = board.order
    .filter((other) => other !== id && board.notes[other])
    .map((other) => noteBounds(board.notes[other]));
  const free = randomFreeNoteCenter(center, Math.max(bounds.width, 1), Math.max(bounds.height, 1), obstacles, false, 1);
  return notePositionAt(free, bounds.width, bounds.height, false, 1);
}

async function importFile(params: RecordValue): Promise<{ node: RecordValue }> {
  assertKeys(params, ["path", "x", "y", "near", "name"], "files.import");
  const path = nonEmptyString(params.path, "path");
  if (!isAbsolutePath(path)) invalid("path", "provide an absolute file path");
  if (!project.path) throw new McpError("no_project", "Open or create a project before importing files.");
  const hasX = params.x !== undefined;
  const hasY = params.y !== undefined;
  if (hasX !== hasY) invalid("x/y", "provide both x and y, or neither");
  if (hasX && params.near !== undefined) invalid("near", "provide either x/y or near, not both");
  const position = hasX
    ? { x: finiteNumber(params.x, "x"), y: finiteNumber(params.y, "y") }
    : null;
  const near = hasX ? null : parseNearTarget(params.near);
  const requestedName = params.name === undefined ? undefined : nonEmptyString(params.name, "name");
  const canonicalName = requestedName === undefined ? undefined : uniqueName(requestedName, []);
  if (canonicalName !== undefined && uniqueName(canonicalName, Object.values(board.notes).map((other) => other.name)) !== canonicalName) {
    throw new McpError("name_conflict", `Node name '${canonicalName}' is already in use. Choose a different name and retry.`);
  }
  const initialCenter = { x: camera.x, y: camera.y };
  const beforeIds = new Set(board.order);
  const kind = boardDropKindForPath(path);
  let imported = false;
  try {
    switch (kind) {
      case "image": imported = await importImagePaths([path], initialCenter); break;
      case "pdf": imported = await importFormatPaths([path], initialCenter, "pdf"); break;
      case "audio": imported = await importAudioPaths([path], initialCenter); break;
      case "video": imported = (await importVideoPaths([path], initialCenter)).length === 1; break;
      case "markdown": imported = await importMarkdownPaths([path], initialCenter); break;
      case "format": imported = await importFormatPaths([path], initialCenter, "text"); break;
      case "source": imported = (await createSourceNotes([path], initialCenter)).length === 1; break;
    }
  } catch (error) {
    throw new McpError("invalid_params", `Hive could not import '${path}': ${errorText(error)}. Verify the path and file type, then retry.`);
  }
  if (!imported) {
    throw new McpError("invalid_params", `Hive could not import '${path}'. Verify that the file exists, uses a supported type, and is within its size limit, then retry.`);
  }

  const id = board.order.at(-1);
  const note = id && !beforeIds.has(id) ? board.notes[id] : undefined;
  if (!id || !note) throw new McpError("internal", "Hive imported the file but did not return its new node. Use nodes.list to inspect the board.");

  let nextName = note.name;
  if (canonicalName !== undefined) {
    const conflict = uniqueName(canonicalName, Object.values(board.notes).filter((other) => other.id !== id).map((other) => other.name));
    if (conflict !== canonicalName) {
      throw new McpError("name_conflict", `Node name '${canonicalName}' is already in use. Choose a different name and retry.`);
    }
    nextName = canonicalName;
  }

  const bounds = noteBounds(note);
  const nextPosition = position ?? (near ? placeNextTo(near.bounds, bounds, near.side, near.gap) : freeSpotFor(id, bounds, initialCenter));
  if (nextName !== note.name || nextPosition && (nextPosition.x !== note.x || nextPosition.y !== note.y)) {
    const before = { name: note.name, x: note.x, y: note.y };
    const after = {
      name: nextName,
      x: nextPosition?.x ?? note.x,
      y: nextPosition?.y ?? note.y,
    };
    execute({
      label: "Set imported node details",
      target: nextName,
      do: () => updateNote(id, after),
      undo: () => updateNote(id, before),
    });
  }
  return { node: summarizeImportedNode(id) };
}

function summarizeImportedNode(id: string): RecordValue {
  const note = board.notes[id];
  if (!note) throw new McpError("internal", "The imported node disappeared before it could be returned.");
  const bounds = noteBounds(note);
  return {
    id: note.id,
    type: note.type,
    name: note.name,
    x: note.x,
    y: note.y,
    width: bounds.width,
    height: bounds.height,
    textPreview: note.text.replace(/\s+/g, " ").trim().slice(0, 160),
    linkCount: Object.values(links.byId).filter((link) => link.from === id || link.to === id).length,
    ...(note.color ? { color: note.color } : {}),
    ...(note.task ? { task: { done: note.task.done } } : {}),
    ...(note.importance ? { importance: note.importance } : {}),
    ...(note.purposes ? { purposes: [...note.purposes] } : {}),
    ...(note.moods ? { moods: [...note.moods] } : {}),
    ...(note.zoneId ? { zoneId: note.zoneId } : {}),
  };
}

function restoreTrash(params: RecordValue): { restored: RecordValue[] } {
  assertKeys(params, ["ids"], "trash.restore");
  const ids = uniqueStrings(params.ids, "ids");
  const planned = ids.map((id) => {
    const entry = trash.entries.find((candidate) => candidate.id === id);
    if (!entry) throw notFound(`Trash entry '${id}'`, "Use trash.list to get valid entry ids.");
    const preview = previewRestore(id);
    if (!preview) throw notFound(`Trash entry '${id}'`, "Use trash.list to get valid entry ids.");
    return { id, entry, preview };
  });
  const occupiedIds = new Set(Object.keys(board.notes));
  const occupiedZoneIds = new Set(Object.keys(zones.byId));
  for (const { id, entry, preview } of planned) {
    const duplicateIds = entry.notes.map((note) => note.id).filter((noteId) => occupiedIds.has(noteId));
    const conflicts = [...new Set([...preview.idConflicts, ...duplicateIds])];
    if (conflicts.length > 0) {
      throw new McpError("invalid_params", `Trash entry '${id}' cannot be restored because node ids already exist. Resolve or remove the conflicting nodes, then retry.`, { idConflicts: conflicts });
    }
    entry.notes.forEach((note) => occupiedIds.add(note.id));
    const duplicateZoneIds = entry.zones.map((zone) => zone.id).filter((zoneId) => occupiedZoneIds.has(zoneId));
    if (duplicateZoneIds.length > 0) {
      throw new McpError("invalid_params", `Trash entry '${id}' cannot be restored because zone ids already exist. Resolve or remove the conflicting zones, then retry.`, { zoneIdConflicts: duplicateZoneIds });
    }
    entry.zones.forEach((zone) => occupiedZoneIds.add(zone.id));
  }

  const restored = planned.map(({ id, entry }) => {
    const result = restoreTrashEntry(id);
    if (!result) throw notFound(`Trash entry '${id}'`, "Use trash.list to get valid entry ids.");
    if (result.idConflicts.length > 0) {
      throw new McpError("invalid_params", `Trash entry '${id}' cannot be restored because node ids already exist. Resolve or remove the conflicting nodes, then retry.`, { idConflicts: result.idConflicts });
    }
    return {
      id,
      nodeIds: entry.notes.map((note) => note.id),
      zoneIds: entry.zones.map((zone) => zone.id),
      renamed: result.renamed,
      linksRestored: result.linksRestored.map(({ id: linkId }) => linkId),
      linksBroken: result.linksBroken.map(({ link, missingEndpoints, reason }) => ({ id: link.id, missingEndpoints, reason })),
    };
  });
  return { restored };
}

function focusView(params: RecordValue): { focused: { x: number; y: number; width: number; height: number }; camera: { x: number; y: number; zoom: number } } {
  assertKeys(params, ["ids", "bbox", "zoom"], "view.focus");
  const bounds: ZoneBounds[] = [];
  if (params.ids !== undefined) {
    const ids = uniqueStrings(params.ids, "ids");
    for (const id of ids) {
      if (id === ME_OBJECT_ID) {
        if (!hasMeBeacon()) throw notFound(`Node '${id}'`, "Use nodes.list or search to get valid ids.");
        bounds.push({ x: ME_POSITION.x - BEACON_SIZE / 2, y: ME_POSITION.y - BEACON_SIZE / 2, width: BEACON_SIZE, height: BEACON_SIZE });
      }
      else {
        const note = board.notes[id];
        if (!note) throw notFound(`Node '${id}'`, "Use nodes.list or search to get valid ids.");
        bounds.push(noteBounds(note));
      }
    }
  }
  if (params.bbox !== undefined) bounds.push(parseRect(params.bbox, "bbox"));
  if (bounds.length === 0) invalid("ids/bbox", "provide at least one node id or a bbox");
  const focused = unionBounds(bounds);
  if (viewport.width <= 0 || viewport.height <= 0) {
    throw new McpError("unsupported", "The board viewport is not ready yet. Wait for the board to finish opening, then retry.");
  }
  const centerX = focused.x + focused.width / 2;
  const centerY = focused.y + focused.height / 2;
  let zoom: number;
  if (params.zoom === undefined) {
    const availableWidth = Math.max(1, viewport.width - 96);
    const availableHeight = Math.max(1, viewport.height - 96);
    const widthZoom = focused.width > 0 ? availableWidth / (focused.width * 10) : cameraSettings.maxZoom;
    const heightZoom = focused.height > 0 ? availableHeight / (focused.height * 10) : cameraSettings.maxZoom;
    zoom = clamp(Math.min(widthZoom, heightZoom), cameraSettings.minZoom, cameraSettings.maxZoom);
  } else {
    zoom = clamp(positiveNumber(params.zoom, "zoom"), cameraSettings.minZoom, cameraSettings.maxZoom);
  }
  camera.x = centerX;
  camera.y = centerY;
  camera.zoom = zoom;
  refreshPointerWorld();
  return { focused, camera: { x: camera.x, y: camera.y, zoom: camera.zoom } };
}

function undoHistory(params: RecordValue): { undone: string | null } {
  assertKeys(params, ["onlyIfMcp"], "history.undo");
  const onlyIfMcp = params.onlyIfMcp === undefined ? true : booleanValue(params.onlyIfMcp, "onlyIfMcp");
  const top = history.cursor > 0 ? history.entries[history.cursor - 1] : undefined;
  if (!top) return { undone: null };
  if (onlyIfMcp && !top.label.startsWith("MCP:")) {
    throw new McpError("unsupported", `The latest history entry is '${top.label}', not an MCP action. Use the in-app Undo control or make an MCP change before calling history.undo.`);
  }
  return { undone: undo()?.label ?? null };
}

async function saveProject(): Promise<{ saved: true }> {
  if (!project.path) throw new McpError("no_project", "Open or create a project before saving.");
  try {
    await flushPendingSave();
    return { saved: true };
  } catch (error) {
    throw new McpError("internal", `Hive could not save the project: ${errorText(error)}. Retry after resolving the project save error.`);
  }
}

function placeNextTo(target: ZoneBounds, node: { width: number; height: number }, side: "right" | "left" | "below" | "above", gap: number): { x: number; y: number } {
  switch (side) {
    case "right": return { x: target.x + target.width + gap, y: target.y + (target.height - node.height) / 2 };
    case "left": return { x: target.x - gap - node.width, y: target.y + (target.height - node.height) / 2 };
    case "below": return { x: target.x + (target.width - node.width) / 2, y: target.y + target.height + gap };
    case "above": return { x: target.x + (target.width - node.width) / 2, y: target.y - gap - node.height };
  }
}

function linkInfo(link: Link): LinkInfo {
  return {
    id: link.id,
    from: link.from,
    to: link.to,
    kind: link.kind,
    shape: link.shape,
    fromName: link.from === ME_OBJECT_ID ? (hasMeBeacon() ? "ME" : "Missing ME") : board.notes[link.from]?.name ?? "",
    toName: board.notes[link.to]?.name ?? (link.to === ME_OBJECT_ID ? (hasMeBeacon() ? "ME" : "Missing ME") : ""),
  };
}

function objectName(id: string): string {
  return id === ME_OBJECT_ID ? (hasMeBeacon() ? "ME" : "Missing ME") : board.notes[id]?.name ?? "Node";
}

function unionBounds(bounds: readonly ZoneBounds[]): ZoneBounds {
  if (bounds.length === 0) invalid("ids/bbox", "provide at least one node id or a bbox");
  const left = Math.min(...bounds.map((rect) => rect.x));
  const top = Math.min(...bounds.map((rect) => rect.y));
  const right = Math.max(...bounds.map((rect) => rect.x + rect.width));
  const bottom = Math.max(...bounds.map((rect) => rect.y + rect.height));
  return { x: left, y: top, width: right - left, height: bottom - top };
}

function padBounds(bounds: ZoneBounds, padding: number): ZoneBounds {
  return { x: bounds.x - padding, y: bounds.y - padding, width: bounds.width + padding * 2, height: bounds.height + padding * 2 };
}

function uniqueStrings(value: unknown, field: string): string[] {
  const values = array(value, field, true).map((entry, index) => string(entry, `${field}[${index}]`));
  return [...new Set(values)];
}

function assertUnique(values: readonly string[], field: string): void {
  if (new Set(values).size !== values.length) invalid(field, "each id may appear only once");
}

function array(value: unknown, field: string, nonEmpty = false): unknown[] {
  if (!Array.isArray(value) || nonEmpty && value.length === 0) invalid(field, nonEmpty ? "provide a non-empty array" : "must be an array");
  return value;
}

function record(value: unknown, field: string): RecordValue {
  if (typeof value !== "object" || value === null || Array.isArray(value)) invalid(field, "must be an object");
  return value as RecordValue;
}

function assertKeys(value: RecordValue, allowed: readonly string[], field: string): void {
  const unexpected = Object.keys(value).find((key) => !allowed.includes(key));
  if (unexpected) invalid(`${field}.${unexpected}`, "is not supported");
}

function string(value: unknown, field: string): string {
  if (typeof value !== "string" || value.trim().length === 0) invalid(field, "must be a non-empty string");
  return value.trim();
}

function nonEmptyString(value: unknown, field: string): string {
  return string(value, field);
}

function finiteNumber(value: unknown, field: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) invalid(field, "must be a finite number");
  return value;
}

function positiveNumber(value: unknown, field: string): number {
  const parsed = finiteNumber(value, field);
  if (parsed <= 0) invalid(field, "must be greater than zero");
  return parsed;
}

function nonNegativeNumber(value: unknown, field: string): number {
  const parsed = finiteNumber(value, field);
  if (parsed < 0) invalid(field, "must be zero or greater");
  return parsed;
}

function booleanValue(value: unknown, field: string): boolean {
  if (typeof value !== "boolean") invalid(field, "must be true or false");
  return value;
}

function enumValue<const T extends readonly string[]>(value: unknown, options: T, field: string, fallback?: T[number]): T[number] {
  if (value === undefined && fallback !== undefined) return fallback;
  if (typeof value !== "string" || !options.includes(value)) invalid(field, `must be one of ${options.join(", ")}`);
  return value as T[number];
}

function isAbsolutePath(path: string): boolean {
  return path.startsWith("/") || /^\\\\[^\\]+\\[^\\]+/.test(path) || /^[a-zA-Z]:[\\/]/.test(path);
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

function invalid(field: string, guidance: string): never {
  throw new McpError("invalid_params", `Invalid '${field}': ${guidance}.`);
}

function notFound(subject: string, next: string): McpError {
  return new McpError("not_found", `${subject} was not found. ${next}`);
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
