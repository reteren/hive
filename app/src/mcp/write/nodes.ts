import { tick } from "svelte";
import { archiveNotes } from "../../archive/actions.svelte";
import { canArchiveNote } from "../../archive/logic";
import { camera } from "../../board/camera.svelte";
import type { Point } from "../../board/cameraMath";
import { grid } from "../../board/grid.svelte";
import { restartTimeNode } from "../../time/runtime.svelte";
import { linkedImportanceSource, setImportance, setLinkedImportance, toggleMood, togglePurpose } from "../../modules/moduleActions.svelte";
import { clearSelectedLink } from "../../links/selection.svelte";
import { linkRefusalReason } from "../../links/rules";
import { addLink, links, removeLink } from "../../model/links.svelte";
import { ME_OBJECT_ID, type Link, type LineShape } from "../../model/link";
import { hasMeBeacon } from "../../beacons/beaconState.svelte";
import {
  IMPORTANCE_LEVELS,
  MOOD_KINDS,
  PURPOSE_KINDS,
  newId,
  type Note,
  type NoteKind,
  type TaskState,
} from "../../model/note";
import { addNote, board, removeNote, updateNote } from "../../model/board.svelte";
import { zones } from "../../model/zones.svelte";
import { measuredHeights } from "../../notes/layout.svelte";
import { makeNote } from "../../notes/noteCommands";
import { uniqueName } from "../../notes/naming";
import { beaconPaletteColor } from "../../beacons/beaconPalette";
import { renameCalculatorNode } from "../../notes/calculatorRename.svelte";
import {
  creationObstacleForNote,
  estimatedCreationHeight,
  nearestFreeNoteCenter,
  notePositionAt,
  randomFreeNoteCenter,
  CREATION_GAP,
  type CreationObstacle,
} from "../../notes/creationPosition";
import { parseMcpNote } from "../../project/index";
import { parseMessageData } from "../../messages/data";
import { noteFileKey, sanitizeNoteName } from "../../project/fileNames";
import { moveToTrash } from "../../trash/trashActions.svelte";
import { canBeTask, toggleTaskCompletion, toggleTaskFlag } from "../../tasks/taskActions.svelte";
import { captureSelectionSnapshot, clearSelection, restoreSelectionSnapshot, selectOnly, includeSelected, selection } from "../../selection/selection.svelte";
import { execute } from "../../history/history.svelte";
import { McpError, asParams, registerMcpMethod } from "../registry";

const NOTE_KINDS: readonly NoteKind[] = [
  "note", "pro", "con", "importance", "purpose", "mood", "beacon", "goal", "progress", "calculator", "tierlist", "stats",
  "archive", "trash", "inbox", "list", "source", "glossary", "map", "random", "markas", "time", "message", "calendar",
  "image", "pdf", "format", "audio", "video", "youtube",
];
const LINE_SHAPES: readonly LineShape[] = ["base", "orthogonal", "zigzag", "wave"];

type Layout = "auto" | "row" | "column" | "grid" | "tree";
type ArrangeLayout = Exclude<Layout, "auto"> | "circle";
type CreateSpec = Record<string, unknown> & { ref?: string; type?: NoteKind };
type PlannedNote = { spec: CreateSpec; note: Note; ref?: string };

registerMcpMethod({
  name: "nodes.create",
  mutating: true,
  label: (raw) => `create ${Array.isArray((raw as Record<string, unknown>).nodes) ? ((raw as Record<string, unknown>).nodes as unknown[]).length : 0} nodes`,
  run: createNodes,
});

registerMcpMethod({
  name: "nodes.update",
  mutating: true,
  label: (raw) => `update ${Array.isArray((raw as Record<string, unknown>).updates) ? ((raw as Record<string, unknown>).updates as unknown[]).length : 0} nodes`,
  run: updateNodes,
});

registerMcpMethod({
  name: "nodes.delete",
  mutating: true,
  label: (raw) => `delete ${Array.isArray((raw as Record<string, unknown>).ids) ? ((raw as Record<string, unknown>).ids as unknown[]).length : 0} nodes`,
  run: deleteNodes,
});

registerMcpMethod({
  name: "nodes.move",
  mutating: true,
  label: (raw) => `move ${Array.isArray((raw as Record<string, unknown>).moves) ? ((raw as Record<string, unknown>).moves as unknown[]).length : 0} nodes`,
  run: moveNodes,
});

registerMcpMethod({
  name: "nodes.arrange",
  mutating: true,
  label: (raw) => `arrange ${Array.isArray((raw as Record<string, unknown>).ids) ? ((raw as Record<string, unknown>).ids as unknown[]).length : 0} nodes`,
  run: arrangeNodes,
});

async function createNodes(raw: unknown) {
  const params = asParams(raw);
  const specs = requireArray(params.nodes, "nodes", 1, 500).map((value, index) => requireRecord(value, `nodes[${index}]`) as CreateSpec);
  const layout = params.layout === undefined ? "auto" : requireLayout(params.layout, "layout", true) as Layout;
  const origin = readPoint(params.origin, "origin") ?? { x: camera.x, y: camera.y };
  const gap = readGap(params.gap, "gap", CREATION_GAP);

  const refs = new Map<string, string>();
  const assignedIds = specs.map((spec, index) => {
    if (spec.ref !== undefined) {
      const ref = requireString(spec.ref, `nodes[${index}].ref`);
      if (refs.has(ref)) invalid(`nodes[${index}].ref`, `Reference '${ref}' is duplicated.`);
      spec.ref = ref;
      refs.set(ref, newId());
    }
    return spec.ref === undefined ? newId() : refs.get(spec.ref)!;
  });

  const planned: PlannedNote[] = specs.map((spec, index) => {
    const type = spec.type === undefined ? "note" : requireKind(spec.type, `nodes[${index}].type`);
    const note = makeNote(type, assignedIds[index]!, { x: origin.x, y: origin.y }, Date.now());
    if (type === "beacon" && spec.color === undefined && !(spec.data && typeof spec.data === "object" && "color" in spec.data)) {
      note.color = beaconPaletteColor(Object.values(board.notes).filter((existing) => existing.type === "beacon").length +
        specs.slice(0, index).filter((existing) => existing.type === "beacon").length);
    }
    return { spec: { ...spec, type }, note, ...(typeof spec.ref === "string" ? { ref: spec.ref } : {}) };
  });

  const plannedLinks = readCreateLinks(params.links, refs, planned);
  const reservedNames = Object.values(board.notes).map((note) => note.name);
  for (const [index, item] of planned.entries()) {
    applyCreateFields(item.note, item.spec, index, reservedNames);
    reservedNames.push(item.note.name);
  }
  const initialMoves = planCreatedPositions(planned, refs, plannedLinks, layout, origin, gap, measuredHeights);
  for (const [index, item] of planned.entries()) {
    const position = initialMoves[index]!;
    item.note.x = position.x;
    item.note.y = position.y;
    item.note = validateNote(item.note, `nodes[${index}]`);
  }

  const linksToAdd = plannedLinks.map(({ from, to, kind, shape }) => ({ id: newId(), from, to, kind, shape } satisfies Link));
  const ids = planned.map(({ note }) => note.id);
  const previousSelection = captureSelectionSnapshot();
  const startIndex = board.order.length;

  execute({
    label: "Create nodes",
    target: `${planned.length} nodes`,
    do: () => {
      planned.forEach(({ note }, index) => addNote(note, startIndex + index));
      linksToAdd.forEach(addLink);
      for (const { note } of planned) if (note.type === "time") restartTimeNode(note.id);
      clearSelection();
      clearSelectedLink();
      if (ids[0]) selectOnly(ids[0]);
      for (const id of ids.slice(1)) includeSelected(id);
    },
    undo: () => {
      for (const link of [...linksToAdd].reverse()) removeLink(link.id);
      for (const id of [...ids].reverse()) removeNote(id);
      restoreSelectionSnapshot(previousSelection);
    },
  });

  const needsMeasuredPlacement = planned.some(({ spec }) =>
    !Object.prototype.hasOwnProperty.call(spec, "x") && !Object.prototype.hasOwnProperty.call(spec, "y"));
  if (needsMeasuredPlacement) {
    await waitForRenderedHeights(planned.map(({ note }) => note));
    const measuredMoves = planCreatedPositions(planned, refs, plannedLinks, layout, origin, gap, measuredHeights);
    const changedMoves = measuredMoves.filter((move, index) =>
      move.x !== board.notes[planned[index]!.note.id]!.x || move.y !== board.notes[planned[index]!.note.id]!.y,
    );
    if (changedMoves.length > 0) applyPositions(changedMoves, "Position nodes");
  }

  return {
    created: planned.map(({ note, ref }) => {
      const current = board.notes[note.id] ?? note;
      return { ...(ref ? { ref } : {}), id: current.id, name: current.name, x: current.x, y: current.y, width: current.width, height: effectiveHeight(current) };
    }),
    links: linksToAdd.map((link) => link.id),
  };
}

function applyCreateFields(note: Note, spec: CreateSpec, index: number, reservedNames: string[]): void {
  const field = (name: string) => `nodes[${index}].${name}`;
  const namePolicy = spec.onNameConflict === undefined ? "rename" : requireEnum(spec.onNameConflict, ["rename", "error"] as const, field("onNameConflict"));
  const requestedName = spec.name === undefined ? note.name : requireString(spec.name, field("name"));
  const sanitizedName = sanitizeNoteName(requestedName.trim());
  const unique = uniqueName(sanitizedName, reservedNames);
  if (namePolicy === "error" && noteFileKey(unique) !== noteFileKey(sanitizedName)) {
    throw new McpError("name_conflict", `Node name '${sanitizedName}' is already in use. Choose another name or set onNameConflict to 'rename'.`, { field: field("name") });
  }
  note.name = unique;
  if (spec.text !== undefined) note.text = requireString(spec.text, field("text"));
  if (spec.width !== undefined) note.width = requirePositive(spec.width, field("width"));
  if (spec.height !== undefined) note.height = spec.height === null ? null : requirePositive(spec.height, field("height"));
  if (spec.color !== undefined) (note as Note & { color?: string | null }).color = spec.color === null ? undefined : requireString(spec.color, field("color"));
  if (spec.accentColor !== undefined) note.accentColor = spec.accentColor === null ? undefined : requireString(spec.accentColor, field("accentColor"));
  if (spec.glow !== undefined) note.glow = spec.glow === null ? undefined : spec.glow as Note["glow"];
  if (spec.headerHidden !== undefined) note.headerHidden = requireBoolean(spec.headerHidden, field("headerHidden"));
  if (spec.importance !== undefined) note.importance = spec.importance === null ? null : requireEnum(spec.importance, IMPORTANCE_LEVELS, field("importance"));
  if (spec.purposes !== undefined) note.purposes = requireArray(spec.purposes, field("purposes"), 0, 100).map((value, itemIndex) => requireEnum(value, PURPOSE_KINDS, `${field("purposes")}[${itemIndex}]`));
  if (spec.moods !== undefined) note.moods = requireArray(spec.moods, field("moods"), 0, 100).map((value, itemIndex) => requireEnum(value, MOOD_KINDS, `${field("moods")}[${itemIndex}]`));
  if (spec.zoneId !== undefined) note.zoneId = spec.zoneId === null ? null : requireString(spec.zoneId, field("zoneId"));

  if (spec.task !== undefined) {
    if (typeof spec.task === "boolean") note.task = spec.task ? { done: false, doneAt: null } : null;
    else {
      const task = requireRecord(spec.task, field("task"));
      const done = requireBoolean(task.done, `${field("task")}.done`);
      note.task = { done, doneAt: done ? Date.now() : null };
    }
    if (note.task && !canBeTask(note)) invalid(field("task"), `Tasks are supported on ordinary notes and imported text files, not ${note.type} nodes.`);
  }

  if (spec.data !== undefined) {
    const data = requireRecord(spec.data, field("data"));
    for (const forbidden of ["id", "type", "name", "file", "text", "x", "y", "width", "height", "createdAt", "task", "taskMemory", "importance", "purposes", "moods", "color", "accentColor", "glow", "zoneId"]) {
      if (Object.prototype.hasOwnProperty.call(data, forbidden)) invalid(`${field("data")}.${forbidden}`, "Set this field directly on the CreateSpec.");
    }
    Object.assign(note, data);
  }
}

function planCreatedPositions(
  planned: readonly PlannedNote[],
  refs: Map<string, string>,
  plannedLinks: readonly { from: string; to: string }[],
  layout: Layout,
  origin: Point,
  gap: number,
  heights: Readonly<Record<string, number>>,
): Array<{ id: string; x: number; y: number }> {
  const heightFor = (note: Note) => estimatedCreationHeight(note, heights[note.id]);
  const notes = planned.map(({ note }) => note);
  const tree = layout === "tree" ? treeCenters(notes, plannedLinks, origin, gap, heightFor) : null;
  const centers = layout === "auto" ? null : layoutCenters(notes, layout, origin, gap, tree, heightFor);
  const plannedIds = new Set(notes.map((note) => note.id));
  const obstacles = Object.values(board.notes)
    .filter((note) => !plannedIds.has(note.id))
    .map((note) => creationObstacleForNote(note, heights[note.id]));
  const positions = new Map<string, Point>();
  const positioned = new Set<string>();
  const meObstacle = { x: -3.6, y: -3.6, width: 7.2, height: 7.2 };

  for (const [index, item] of planned.entries()) {
    const hasX = Object.prototype.hasOwnProperty.call(item.spec, "x");
    const hasY = Object.prototype.hasOwnProperty.call(item.spec, "y");
    if (hasX !== hasY) invalid(`nodes[${index}].${hasX ? "y" : "x"}`, "Provide both x and y, or neither.");
    if (!hasX || !hasY) continue;
    const position = { x: requireFinite(item.spec.x, `nodes[${index}].x`), y: requireFinite(item.spec.y, `nodes[${index}].y`) };
    const obstacle = creationObstacleForNote({ ...item.note, ...position }, heightFor(item.note));
    if (overlapsAny(obstacle, hasMeBeacon() ? [...obstacles, meObstacle] : obstacles)) invalid(`nodes[${index}].x`, "This position overlaps another node; choose free coordinates.");
    positions.set(item.note.id, position);
    obstacles.push(obstacle);
    positioned.add(item.note.id);
  }

  for (const index of createPlacementOrder(planned, refs)) {
    const item = planned[index]!;
    if (positioned.has(item.note.id)) continue;
    const scale = item.note.scale ?? 1;
    const width = item.note.width * scale;
    const height = heightFor(item.note) * scale;
    let position: Point;

    if (item.spec.near !== undefined) {
      const near = requireRecord(item.spec.near, `nodes[${index}].near`);
      const anchorId = resolveEndpoint(near.node, refs, `nodes[${index}].near.node`);
      const plannedAnchor = planned.find((candidate) => candidate.note.id === anchorId);
      if (plannedAnchor && !positioned.has(anchorId)) invalid(`nodes[${index}].near.node`, "A near ref must refer to a node with explicit coordinates or a non-circular near ref.");
      const anchor = plannedAnchor?.note ?? board.notes[anchorId];
      if (!anchor && (anchorId !== ME_OBJECT_ID || !hasMeBeacon())) throw new McpError("not_found", `Node '${anchorId}' not found. Use nodes.list or search to get ids.`);
      const side = near.side === undefined ? "right" : requireEnum(near.side, ["right", "left", "below", "above"] as const, `nodes[${index}].near.side`);
      const nearGap = readGap(near.gap, `nodes[${index}].near.gap`, gap);
      const anchorPosition = plannedAnchor ? positions.get(anchorId)! : undefined;
      const anchorBox = anchor
        ? creationObstacleForNote(anchorPosition ? { ...anchor, ...anchorPosition } : anchor, heightFor(anchor))
        : meObstacle;
      const desired = centerBeside(anchorBox, width, height, side, nearGap);
      const freeCenter = nearestFreeNoteCenter(desired, width, height, obstacles, false, grid.step);
      position = notePositionAt(freeCenter, width, height, false, grid.step);
    } else if (layout === "auto") {
      const freeCenter = randomFreeNoteCenter(origin, width, height, obstacles, grid.snap, grid.step);
      position = notePositionAt(freeCenter, width, height, false, grid.step);
    } else {
      const center = centers?.[index] ?? origin;
      const freeCenter = nearestFreeNoteCenter(center, width, height, obstacles, false, grid.step);
      position = notePositionAt(freeCenter, width, height, false, grid.step);
    }

    positions.set(item.note.id, position);
    obstacles.push(creationObstacleForNote({ ...item.note, ...position }, heightFor(item.note)));
    positioned.add(item.note.id);
  }

  return planned.map(({ note }) => ({ id: note.id, ...positions.get(note.id)! }));
}

function createPlacementOrder(planned: readonly PlannedNote[], refs: Map<string, string>): number[] {
  const indexById = new Map(planned.map((item, index) => [item.note.id, index]));
  const dependencies = planned.map((item, index) => {
    if (item.spec.x !== undefined && item.spec.y !== undefined || !item.spec.near) return null;
    const near = requireRecord(item.spec.near, `nodes[${index}].near`);
    const anchor = resolveEndpoint(near.node, refs, `nodes[${index}].near.node`);
    const dependency = indexById.get(anchor);
    return dependency === undefined ? null : dependency;
  });
  const result: number[] = [];
  const visited = new Set<number>();
  while (result.length < planned.length) {
    let progress = false;
    for (let index = 0; index < planned.length; index += 1) {
      if (visited.has(index)) continue;
      const dependency = dependencies[index];
      if (dependency !== null && !visited.has(dependency)) continue;
      visited.add(index);
      result.push(index);
      progress = true;
    }
    if (!progress) invalid("nodes[].near.node", "Near refs form a cycle. Point each node to an existing node or a ref outside the cycle.");
  }
  return result;
}

function readCreateLinks(value: unknown, refs: Map<string, string>, planned: PlannedNote[]) {
  if (value === undefined) return [] as Array<{ from: string; to: string; kind: Link["kind"]; shape: LineShape }>;
  const specs = requireArray(value, "links", 0, 1000);
  const lookup = Object.fromEntries([...Object.values(board.notes), ...planned.map((item) => item.note)].map((note) => [note.id, note])) as Record<string, Note>;
  const existing = Object.values(links.byId).map((link) => ({ from: link.from, to: link.to, kind: link.kind }));
  const result: Array<{ from: string; to: string; kind: Link["kind"]; shape: LineShape }> = [];
  specs.forEach((raw, index) => {
    const spec = requireRecord(raw, `links[${index}]`);
    const from = resolveEndpoint(spec.from, refs, `links[${index}].from`);
    const to = resolveEndpoint(spec.to, refs, `links[${index}].to`);
    if (!lookup[from] && from !== "me") throw new McpError("not_found", `Node '${from}' not found. Use nodes.list or search to get ids.`);
    if (!lookup[to] && to !== "me") throw new McpError("not_found", `Node '${to}' not found. Use nodes.list or search to get ids.`);
    const kind = spec.kind === undefined ? "strong" : requireEnum(spec.kind, ["strong"] as const, `links[${index}].kind`);
    const shape = spec.shape === undefined ? "base" : requireEnum(spec.shape, LINE_SHAPES, `links[${index}].shape`);
    const refusal = linkRefusalReason(from, to, kind, existing, lookup);
    if (refusal) invalid(`links[${index}]`, `${refusal} Choose another pair of nodes.`);
    existing.push({ from, to, kind });
    result.push({ from, to, kind, shape });
  });
  return result;
}

function updateNodes(raw: unknown) {
  const params = asParams(raw);
  const updates = requireArray(params.updates, "updates", 1, 500).map((value, index) => requireRecord(value, `updates[${index}]`));
  const seen = new Set<string>();
  const prepared = updates.map((update, index) => {
    const id = requireString(update.id, `updates[${index}].id`);
    if (seen.has(id)) invalid(`updates[${index}].id`, `Node '${id}' appears more than once.`);
    seen.add(id);
    const note = board.notes[id];
    if (!note) throw new McpError("not_found", `Node '${id}' not found. Use nodes.list or search to get ids.`);
    const data = update.data === undefined ? {} : requireRecord(update.data, `updates[${index}].data`);
    for (const forbidden of ["id", "type", "name", "file", "text", "x", "y", "width", "height", "createdAt", "task", "importance", "purposes", "moods", "color", "accentColor", "glow", "zoneId"]) {
      if (Object.prototype.hasOwnProperty.call(data, forbidden)) invalid(`updates[${index}].data.${forbidden}`, "Set this field directly on the update.");
    }
    const candidate = { ...note, ...data } as Note;
    const changedFields = new Set(Object.keys(data));
    if (update.name !== undefined) candidate.name = requireString(update.name, `updates[${index}].name`);
    if (update.text !== undefined && update.textEdit !== undefined) invalid(`updates[${index}].textEdit`, "Provide text or textEdit, not both.");
    if (update.text !== undefined) { candidate.text = requireString(update.text, `updates[${index}].text`); changedFields.add("text"); }
    if (update.textEdit !== undefined) { candidate.text = applyTextEdit(note.text, update.textEdit, index); changedFields.add("text"); }
    if (update.x !== undefined) { candidate.x = requireFinite(update.x, `updates[${index}].x`); changedFields.add("x"); }
    if (update.y !== undefined) { candidate.y = requireFinite(update.y, `updates[${index}].y`); changedFields.add("y"); }
    if (update.width !== undefined) { candidate.width = requirePositive(update.width, `updates[${index}].width`); changedFields.add("width"); }
    if (Object.prototype.hasOwnProperty.call(update, "height")) { candidate.height = update.height === null ? null : requirePositive(update.height, `updates[${index}].height`); changedFields.add("height"); }
    if (Object.prototype.hasOwnProperty.call(update, "color")) { (candidate as Note & { color?: string | null }).color = update.color === null ? undefined : requireString(update.color, `updates[${index}].color`); changedFields.add("color"); }
    if (Object.prototype.hasOwnProperty.call(update, "accentColor")) { candidate.accentColor = update.accentColor === null ? undefined : requireString(update.accentColor, `updates[${index}].accentColor`); changedFields.add("accentColor"); }
    if (Object.prototype.hasOwnProperty.call(update, "glow")) { candidate.glow = update.glow === null ? undefined : update.glow as Note["glow"]; changedFields.add("glow"); }
    if (update.headerHidden !== undefined) { candidate.headerHidden = requireBoolean(update.headerHidden, `updates[${index}].headerHidden`); changedFields.add("headerHidden"); }
    if (update.importance !== undefined) { candidate.importance = update.importance === null ? null : requireEnum(update.importance, IMPORTANCE_LEVELS, `updates[${index}].importance`); changedFields.add("importance"); }
    if (update.purposes !== undefined) { candidate.purposes = requireArray(update.purposes, `updates[${index}].purposes`, 0, 100).map((value, i) => requireEnum(value, PURPOSE_KINDS, `updates[${index}].purposes[${i}]`)); changedFields.add("purposes"); }
    if (update.moods !== undefined) { candidate.moods = requireArray(update.moods, `updates[${index}].moods`, 0, 100).map((value, i) => requireEnum(value, MOOD_KINDS, `updates[${index}].moods[${i}]`)); changedFields.add("moods"); }
    if (Object.prototype.hasOwnProperty.call(update, "zoneId")) { candidate.zoneId = update.zoneId === null ? null : requireString(update.zoneId, `updates[${index}].zoneId`); changedFields.add("zoneId"); }
    if (Object.prototype.hasOwnProperty.call(update, "task")) {
      const task = update.task;
      if (task === null || task === false) candidate.task = null;
      else if (task === true) candidate.task = { done: false, doneAt: null };
      else {
        const value = requireRecord(task, `updates[${index}].task`);
        candidate.task = { done: requireBoolean(value.done, `updates[${index}].task.done`), doneAt: value.done ? Date.now() : null };
      }
      if (candidate.task && !canBeTask(candidate) && !note.task) invalid(`updates[${index}].task`, `Tasks are supported on ordinary notes and imported text files, not ${note.type} nodes.`);
    }

    if (Object.prototype.hasOwnProperty.call(update, "task")) changedFields.add("task");
    const parsed = validateNote(candidate, `updates[${index}]`);
    if (update.name !== undefined) {
      const desired = sanitizeNoteName(parsed.name.trim());
      const conflicts = Object.values(board.notes).filter((other) => other.id !== id).map((other) => other.name);
      const unique = uniqueName(desired, conflicts);
      if (noteFileKey(unique) !== noteFileKey(desired)) {
        throw new McpError("name_conflict", `Node name '${desired}' is already in use. Choose another name before renaming.`, { field: `updates[${index}].name` });
      }
      parsed.name = unique;
    }
    if (Object.prototype.hasOwnProperty.call(data, "image") && !Object.prototype.hasOwnProperty.call(update, "height") && parsed.height !== note.height) changedFields.add("height");
    return { id, before: note, after: parsed, update, data, changedFields };
  });

  for (const item of prepared) {
    const { id, before, after, update, data, changedFields } = item;
    const patch: Record<string, unknown> = {};
    for (const key of changedFields) patch[key] = cloneValue((after as unknown as Record<string, unknown>)[key]);
    const actionFields = new Set(["task", "importance", "purposes", "moods"]);
    for (const key of actionFields) delete (patch as Record<string, unknown>)[key];
    for (const key of Object.keys(patch)) {
      if (sameValue((before as unknown as Record<string, unknown>)[key], patch[key])) delete patch[key];
    }

    if (Object.keys(patch).length > 0) {
      const prior = snapshotFields(before, Object.keys(patch));
      const next = cloneObject(patch);
      execute({
        label: "Update node",
        target: after.name,
        do: () => applyNotePatch(id, next),
        undo: () => applyNotePatch(id, prior),
      });
    }

    const hasImportance = Object.prototype.hasOwnProperty.call(update, "importance") || Object.prototype.hasOwnProperty.call(data, "importance");
    if (hasImportance) {
      const level = after.importance ?? null;
      const linkedSource = linkedImportanceSource(id);
      if (linkedSource) {
        if (level === null) invalid(`updates.${id}.importance`, "This node inherits Importance from a linked module. Change that module or remove its link first.");
        if (!setLinkedImportance(id, level)) invalid(`updates.${id}.importance`, "The linked Importance source changed; refresh nodes.get and try again.");
      } else setImportance(id, level);
      if ((board.notes[id]?.importance ?? null) !== level) invalid(`updates.${id}.importance`, "This Importance is controlled by a linked module. Change its source or remove its link first.");
    }

    if (Object.prototype.hasOwnProperty.call(update, "purposes") || Object.prototype.hasOwnProperty.call(data, "purposes")) {
      const desired = new Set(after.purposes ?? []);
      const current = new Set(board.notes[id]?.purposes ?? []);
      for (const kind of PURPOSE_KINDS) if (current.has(kind) !== desired.has(kind)) togglePurpose(id, kind);
    }
    if (Object.prototype.hasOwnProperty.call(update, "moods") || Object.prototype.hasOwnProperty.call(data, "moods")) {
      const desired = new Set(after.moods ?? []);
      const current = new Set(board.notes[id]?.moods ?? []);
      for (const kind of MOOD_KINDS) if (current.has(kind) !== desired.has(kind)) toggleMood(id, kind);
    }
    if (Object.prototype.hasOwnProperty.call(update, "task")) applyTask(id, after.task ?? null);

    if (update.name !== undefined && before.name !== after.name) {
      const current = board.notes[id];
      if (current?.type === "calculator") {
        const result = renameCalculatorNode(id, after.name);
        if (!result.ok) throw new McpError("name_conflict", result.message, { field: "name" });
      } else {
        const previous = board.notes[id]?.name ?? before.name;
        const target = after.name;
        execute({ label: "Rename", target, do: () => updateNote(id, { name: target }), undo: () => updateNote(id, { name: previous }) });
      }
    }
  }
  return { nodes: prepared.map(({ id }) => summarize(board.notes[id]!)) };
}

function deleteNodes(raw: unknown) {
  const params = asParams(raw);
  const ids = requireIds(params.ids, "ids");
  for (const id of ids) if (!board.notes[id]) throw new McpError("not_found", `Node '${id}' not found. Use nodes.list or search to get ids.`);
  const mode = params.mode === undefined ? "trash" : requireEnum(params.mode, ["trash", "archive"] as const, "mode");
  if (mode === "archive") {
    const blocked = ids.find((id) => !canArchiveNote(board.notes[id]));
    if (blocked) invalid("ids", `Node '${board.notes[blocked]!.name}' cannot be archived. Beacons, Archive, and Trash nodes stay on the board.`);
    const count = archiveNotes(ids);
    if (count !== ids.length) invalid("ids", "One or more nodes could not be archived; refresh nodes.list and try again.");
  } else {
    const result = moveToTrash(ids, [], { label: "Delete", target: ids.length === 1 ? board.notes[ids[0]!]!.name : `${ids.length} nodes` });
    if (!result) invalid("ids", "No matching nodes were deleted. Refresh nodes.list and try again.");
  }
  return { deleted: ids };
}

function moveNodes(raw: unknown) {
  const params = asParams(raw);
  const moves = requireArray(params.moves, "moves", 1, 500).map((value, index) => requireRecord(value, `moves[${index}]`));
  const seen = new Set<string>();
  const planned = moves.map((move, index) => {
    const id = requireString(move.id, `moves[${index}].id`);
    if (seen.has(id)) invalid(`moves[${index}].id`, `Node '${id}' appears more than once.`);
    seen.add(id);
    if (!board.notes[id]) throw new McpError("not_found", `Node '${id}' not found. Use nodes.list or search to get ids.`);
    return { id, x: requireFinite(move.x, `moves[${index}].x`), y: requireFinite(move.y, `moves[${index}].y`) };
  });
  applyPositions(planned, "Move nodes");
  return { nodes: planned.map(({ id }) => summarize(board.notes[id]!)) };
}

async function arrangeNodes(raw: unknown) {
  const params = asParams(raw);
  const ids = requireIds(params.ids, "ids");
  const layout = requireLayout(params.layout, "layout", false) as ArrangeLayout;
  const gap = readGap(params.gap, "gap", CREATION_GAP);
  const notes = ids.map((id) => {
    const note = board.notes[id];
    if (!note) throw new McpError("not_found", `Node '${id}' not found. Use nodes.list or search to get ids.`);
    return note;
  });
  await waitForRenderedHeights(notes);
  const origin = readPoint(params.origin, "origin") ?? selectionCenter(notes);
  const heightFor = (note: Note) => estimatedCreationHeight(note, measuredHeights[note.id]);
  const centers = layout === "tree"
    ? treeCenters(notes, Object.values(links.byId).map(({ from, to }) => ({ from, to })), origin, gap, heightFor)
    : layout === "circle"
      ? circleCenters(notes, origin, gap, heightFor)
      : layoutCenters(notes, layout, origin, gap, null, heightFor);
  const excluded = new Set(ids);
  const obstacles = Object.values(board.notes).filter((note) => !excluded.has(note.id)).map((note) => creationObstacleForNote(note, measuredHeights[note.id]));
  const moves = notes.map((note, index) => {
    const width = note.width * (note.scale ?? 1);
    const height = heightFor(note) * (note.scale ?? 1);
    const center = centers[index] ?? origin;
    const free = nearestFreeNoteCenter(center, width, height, obstacles, false, grid.step);
    const position = notePositionAt(free, width, height, false, grid.step);
    obstacles.push(creationObstacleForNote({ ...note, ...position }, height));
    return { id: note.id, ...position };
  });
  applyPositions(moves, "Arrange nodes");
  return { nodes: moves.map(({ id }) => summarize(board.notes[id]!)) };
}

function applyPositions(moves: readonly { id: string; x: number; y: number }[], label: string): void {
  const before = moves.map(({ id }) => ({ id, x: board.notes[id]!.x, y: board.notes[id]!.y }));
  const previousSelection = captureSelectionSnapshot();
  execute({
    label,
    target: `${moves.length} nodes`,
    do: () => {
      moves.forEach(({ id, x, y }) => updateNote(id, { x, y }));
      clearSelection();
      if (moves[0]) selectOnly(moves[0].id);
      for (const move of moves.slice(1)) includeSelected(move.id);
    },
    undo: () => {
      before.forEach(({ id, x, y }) => updateNote(id, { x, y }));
      restoreSelectionSnapshot(previousSelection);
    },
  });
}

function applyTask(id: string, desired: TaskState | null): void {
  const note = board.notes[id];
  if (!note) return;
  if (Boolean(note.task) !== Boolean(desired)) {
    const savedIds = [...selection.ids];
    const savedPrimary = selection.primaryId;
    selection.ids = [id];
    selection.primaryId = id;
    try {
      toggleTaskFlag(id);
    } finally {
      selection.ids = savedIds;
      selection.primaryId = savedPrimary;
    }
  }
  const current = board.notes[id]?.task;
  if (current && desired && current.done !== desired.done) {
    const result = toggleTaskCompletion(id);
    if (!result.ok) invalid("task", `Task state for '${board.notes[id]?.name ?? id}' could not be changed; refresh nodes.get and try again.`);
  }
}

function applyNotePatch(id: string, patch: Partial<Omit<Note, "id" | "type">>): void {
  const defined: Record<string, unknown> = {};
  const absent: string[] = [];
  for (const [key, value] of Object.entries(patch)) {
    if (value === undefined) absent.push(key);
    else defined[key] = value;
  }
  updateNote(id, defined as Partial<Omit<Note, "id" | "type">>);
  const note = board.notes[id] as unknown as Record<string, unknown> | undefined;
  if (note) for (const key of absent) delete note[key];
}

function validateNote(value: Note, path: string): Note {
  let parsed: ReturnType<typeof parseMcpNote>;
  try {
    parsed = parseMcpNote(value, new Set(Object.keys(zones.byId)));
  } catch (error) {
    const message = error instanceof Error ? error.message : "The note is invalid.";
    const field = fieldFromMessage(message);
    invalid(`${path}.${field}`, message);
  }
  for (const warning of parsed.warnings) {
    if (warning.startsWith("Missing image height for note ")) continue;
    const field = fieldFromMessage(warning);
    if (/Invalid or missing file data/i.test(warning)) {
      invalid(`${path}.media`, `${warning} Use files.import to create media nodes with their file data.`);
    }
    if (/Invalid or missing (?:image|YouTube) data/i.test(warning)) {
      invalid(`${path}.${field}`, `${warning} Use files.import to create media nodes with their file data.`);
    }
    invalid(`${path}.${field}`, warning);
  }
  const source = value as unknown as Record<string, unknown>;
  const normalizedInput = parsed.note as unknown as Record<string, unknown>;
  for (const key of ["glow", "scope", "tiers", "listItems", "source", "randomPick", "customMarks", "message"]) {
    if (source[key] !== undefined && source[key] !== null && normalizedInput[key] === undefined) invalid(`${path}.${key}`, `The ${key} field is not valid for this node. Check its fields and allowed values.`);
  }
  if (source.message !== undefined && !parseMessageData(source.message)) invalid(`${path}.message`, "Message settings are invalid. Use the Message node's supported settings.");
  const normalized = { ...parsed.note } as unknown as Record<string, unknown>;
  delete normalized.file;
  for (const [key, empty] of [["task", null], ["taskMemory", null], ["importance", null], ["purposes", []], ["moods", []], ["zoneId", null]] as const) {
    if (source[key] === undefined && (Array.isArray(empty) ? Array.isArray(normalized[key]) && (normalized[key] as unknown[]).length === 0 : normalized[key] === empty)) {
      delete normalized[key];
    }
  }
  for (const [key, value] of Object.entries(normalized)) if (value === undefined) delete normalized[key];
  return normalized as unknown as Note;
}

function applyTextEdit(text: string, raw: unknown, updateIndex: number): string {
  const path = `updates[${updateIndex}].textEdit`;
  const edit = requireRecord(raw, path);
  if (Object.prototype.hasOwnProperty.call(edit, "append")) return text + requireString(edit.append, `${path}.append`);
  if (Object.prototype.hasOwnProperty.call(edit, "prepend")) return requireString(edit.prepend, `${path}.prepend`) + text;
  const find = requireString(edit.find, `${path}.find`);
  const replace = requireString(edit.replace, `${path}.replace`);
  if (!find) invalid(`${path}.find`, "Search text must not be empty.");
  const count = text.split(find).length - 1;
  const all = edit.all === undefined ? false : requireBoolean(edit.all, `${path}.all`);
  if (count === 0 || (!all && count !== 1)) invalid(`${path}.find`, `Found ${count} exact matches; provide a unique string or set all:true.`);
  return all ? text.split(find).join(replace) : text.replace(find, replace);
}

function snapshotFields(note: Note, keys: string[]): Partial<Omit<Note, "id" | "type">> {
  const snapshot: Record<string, unknown> = {};
  for (const key of keys) snapshot[key] = cloneValue((note as unknown as Record<string, unknown>)[key]);
  return snapshot as Partial<Omit<Note, "id" | "type">>;
}

function cloneObject<T extends Record<string, unknown>>(value: T): T {
  const result: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value)) result[key] = cloneValue(item);
  return result as T;
}

function cloneValue<T>(value: T): T {
  if (value === undefined || value === null || typeof value !== "object") return value;
  return structuredClone(value);
}

function sameValue(first: unknown, second: unknown): boolean {
  if (Object.is(first, second)) return true;
  if (first === undefined || second === undefined) return false;
  try { return JSON.stringify(first) === JSON.stringify(second); }
  catch { return false; }
}

function summarize(note: Note) {
  const plain = note.text.replace(/!\[[^\]]*\]\([^)]*\)/g, " ").replace(/\[([^\]]+)\]\([^)]*\)/g, "$1").replace(/[#>*_`~|-]/g, " ").replace(/\s+/g, " ").trim();
  return {
    id: note.id,
    type: note.type,
    name: note.name,
    x: note.x,
    y: note.y,
    width: note.width,
    height: effectiveHeight(note),
    ...(note.color ? { color: note.color } : {}),
    ...(note.task ? { task: { done: note.task.done } } : {}),
    ...(note.importance ? { importance: note.importance } : {}),
    ...(note.purposes?.length ? { purposes: [...note.purposes] } : {}),
    ...(note.moods?.length ? { moods: [...note.moods] } : {}),
    ...(note.zoneId ? { zoneId: note.zoneId } : {}),
    textPreview: plain.slice(0, 160),
    linkCount: Object.values(links.byId).filter((link) => link.from === note.id || link.to === note.id).length,
  };
}

function effectiveHeight(note: Note): number {
  return note.height ?? measuredHeights[note.id] ?? estimatedCreationHeight(note);
}

async function waitForRenderedHeights(notes: readonly Note[]): Promise<void> {
  const deadline = Date.now() + 500;
  await tick();
  if (!(await waitForAnimationFrame(deadline))) return;
  if (!(await waitForAnimationFrame(deadline))) return;

  const needsMeasurement = notes.filter((note) => note.height == null);
  while (needsMeasurement.some((note) => !validMeasuredHeight(measuredHeights[note.id]))) {
    if (!(await waitForAnimationFrame(deadline))) return;
  }
}

function validMeasuredHeight(height: number | undefined): height is number {
  return typeof height === "number" && Number.isFinite(height) && height > 0;
}

function waitForAnimationFrame(deadline: number): Promise<boolean> {
  const requestFrame = globalThis.requestAnimationFrame;
  if (typeof requestFrame !== "function") return Promise.resolve(false);
  const remaining = deadline - Date.now();
  if (remaining <= 0) return Promise.resolve(false);
  return new Promise((resolve) => {
    let settled = false;
    const finish = (result: boolean) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(result);
    };
    const timer = setTimeout(() => finish(false), remaining);
    requestFrame(() => finish(true));
  });
}

function layoutCenters(
  notes: readonly Note[],
  layout: Layout,
  origin: Point,
  gap: number,
  tree?: Point[] | null,
  heightFor: (note: Note) => number = (note) => estimatedCreationHeight(note, measuredHeights[note.id]),
): Point[] {
  if (layout === "tree" && tree) return tree;
  const count = notes.length;
  if (layout === "row") {
    const totalWidth = notes.reduce((sum, note) => sum + note.width * (note.scale ?? 1), 0) + Math.max(0, count - 1) * gap;
    let x = origin.x - totalWidth / 2;
    return notes.map((note) => {
      const width = note.width * (note.scale ?? 1);
      const center = { x: x + width / 2, y: origin.y };
      x += width + gap;
      return center;
    });
  }
  if (layout === "column") {
    const totalHeight = notes.reduce((sum, note) => sum + heightFor(note) * (note.scale ?? 1), 0) + Math.max(0, count - 1) * gap;
    let y = origin.y - totalHeight / 2;
    return notes.map((note) => {
      const height = heightFor(note) * (note.scale ?? 1);
      const center = { x: origin.x, y: y + height / 2 };
      y += height + gap;
      return center;
    });
  }
  const columns = Math.max(1, Math.ceil(Math.sqrt(count)));
  const rows = Math.ceil(count / columns);
  const colWidths = Array.from({ length: columns }, (_, col) => Math.max(...notes.filter((_, index) => index % columns === col).map((note) => note.width * (note.scale ?? 1)), 0));
  const rowHeights = Array.from({ length: rows }, (_, row) => Math.max(...notes.slice(row * columns, (row + 1) * columns).map((note) => heightFor(note) * (note.scale ?? 1)), 0));
  const totalWidth = colWidths.reduce((sum, width) => sum + width, 0) + Math.max(0, columns - 1) * gap;
  const totalHeight = rowHeights.reduce((sum, height) => sum + height, 0) + Math.max(0, rows - 1) * gap;
  const colStarts: number[] = [];
  const rowStarts: number[] = [];
  let x = origin.x - totalWidth / 2;
  for (const width of colWidths) { colStarts.push(x); x += width + gap; }
  let y = origin.y - totalHeight / 2;
  for (const height of rowHeights) { rowStarts.push(y); y += height + gap; }
  return notes.map((note, index) => {
    const row = Math.floor(index / columns);
    const col = index % columns;
    const width = note.width * (note.scale ?? 1);
    const height = heightFor(note) * (note.scale ?? 1);
    return { x: colStarts[col]! + width / 2, y: rowStarts[row]! + height / 2 };
  });
}

function treeCenters(
  notes: readonly Note[],
  edges: readonly { from: string; to: string }[],
  origin: Point,
  gap: number,
  heightFor: (note: Note) => number = (note) => estimatedCreationHeight(note, measuredHeights[note.id]),
): Point[] {
  const ids = new Set(notes.map((note) => note.id));
  const incoming = new Set(edges.filter((edge) => ids.has(edge.from) && ids.has(edge.to)).map((edge) => edge.to));
  const roots = notes.filter((note) => !incoming.has(note.id));
  const queue = [...(roots.length ? roots : notes.slice(0, 1)).map((note) => ({ id: note.id, depth: 0 }))];
  const depthById = new Map<string, number>();
  const children = new Map<string, string[]>();
  for (const edge of edges) if (ids.has(edge.from) && ids.has(edge.to)) children.set(edge.from, [...(children.get(edge.from) ?? []), edge.to]);
  while (queue.length) {
    const item = queue.shift()!;
    if (depthById.has(item.id)) continue;
    depthById.set(item.id, item.depth);
    for (const child of children.get(item.id) ?? []) queue.push({ id: child, depth: item.depth + 1 });
  }
  for (const note of notes) if (!depthById.has(note.id)) depthById.set(note.id, 0);
  const levels = [...new Set(depthById.values())].sort((a, b) => a - b);
  const maxWidth = new Map<number, number>();
  for (const depth of levels) maxWidth.set(depth, Math.max(...notes.filter((note) => depthById.get(note.id) === depth).map((note) => note.width * (note.scale ?? 1))));
  const xByDepth = new Map<number, number>();
  let x = origin.x;
  for (const depth of levels) {
    const width = maxWidth.get(depth) ?? 0;
    xByDepth.set(depth, x + width / 2);
    x += width + gap;
  }
  return notes.map((note) => {
    const depth = depthById.get(note.id) ?? 0;
    const siblings = notes.filter((candidate) => depthById.get(candidate.id) === depth);
    const row = siblings.findIndex((candidate) => candidate.id === note.id);
    const totalHeight = siblings.reduce((sum, sibling) => sum + heightFor(sibling) * (sibling.scale ?? 1), 0) + Math.max(0, siblings.length - 1) * gap;
    let y = origin.y - totalHeight / 2;
    for (const sibling of siblings.slice(0, row)) y += heightFor(sibling) * (sibling.scale ?? 1) + gap;
    return { x: xByDepth.get(depth) ?? origin.x, y: y + heightFor(note) * (note.scale ?? 1) / 2 };
  });
}

function circleCenters(
  notes: readonly Note[],
  origin: Point,
  gap: number,
  heightFor: (note: Note) => number = (note) => estimatedCreationHeight(note, measuredHeights[note.id]),
): Point[] {
  if (notes.length <= 1) return notes.map(() => ({ ...origin }));
  const circumference = notes.reduce((sum, note) => sum + Math.max(note.width * (note.scale ?? 1), heightFor(note) * (note.scale ?? 1)), 0) + notes.length * gap;
  const radius = Math.max(10, circumference / (2 * Math.PI));
  return notes.map((_, index) => {
    const angle = -Math.PI / 2 + 2 * Math.PI * index / notes.length;
    return { x: origin.x + Math.cos(angle) * radius, y: origin.y + Math.sin(angle) * radius };
  });
}

function centerBeside(anchor: CreationObstacle, width: number, height: number, side: string, gap: number): Point {
  if (side === "right") return { x: anchor.x + anchor.width + gap + width / 2, y: anchor.y + anchor.height / 2 };
  if (side === "left") return { x: anchor.x - gap - width / 2, y: anchor.y + anchor.height / 2 };
  if (side === "below") return { x: anchor.x + anchor.width / 2, y: anchor.y + anchor.height + gap + height / 2 };
  return { x: anchor.x + anchor.width / 2, y: anchor.y - gap - height / 2 };
}

function overlapsAny(candidate: CreationObstacle, others: readonly CreationObstacle[]): boolean {
  return others.some((other) => candidate.x < other.x + other.width && candidate.x + candidate.width > other.x && candidate.y < other.y + other.height && candidate.y + candidate.height > other.y);
}

function selectionCenter(notes: readonly Note[]): Point {
  if (notes.length === 0) return { x: camera.x, y: camera.y };
  const left = Math.min(...notes.map((note) => note.x));
  const top = Math.min(...notes.map((note) => note.y));
  const right = Math.max(...notes.map((note) => note.x + note.width * (note.scale ?? 1)));
  const bottom = Math.max(...notes.map((note) => note.y + effectiveHeight(note) * (note.scale ?? 1)));
  return { x: (left + right) / 2, y: (top + bottom) / 2 };
}

function resolveEndpoint(value: unknown, refs: Map<string, string>, path: string): string {
  const endpoint = requireString(value, path);
  if (endpoint === "me") return endpoint;
  return refs.get(endpoint) ?? endpoint;
}

function requireKind(value: unknown, path: string): NoteKind {
  return requireEnum(value, NOTE_KINDS, path);
}

function requireLayout(value: unknown, path: string, allowAuto: boolean): Layout | ArrangeLayout {
  const layouts = allowAuto ? ["auto", "row", "column", "grid", "tree"] as const : ["row", "column", "grid", "tree", "circle"] as const;
  return requireEnum(value, layouts, path);
}

function requireIds(value: unknown, path: string): string[] {
  const ids = requireArray(value, path, 1, 500).map((item, index) => requireString(item, `${path}[${index}]`));
  if (new Set(ids).size !== ids.length) invalid(path, "Node ids must be unique.");
  return ids;
}

function readPoint(value: unknown, path: string): Point | undefined {
  if (value === undefined) return undefined;
  const point = requireRecord(value, path);
  return { x: requireFinite(point.x, `${path}.x`), y: requireFinite(point.y, `${path}.y`) };
}

function readGap(value: unknown, path: string, fallback: number): number {
  if (value === undefined) return fallback;
  const gap = requireFinite(value, path);
  if (gap < 0) invalid(path, "Gap must be zero or greater.");
  return gap;
}

function requireArray(value: unknown, path: string, min = 0, max = 500): unknown[] {
  if (!Array.isArray(value) || value.length < min || value.length > max) invalid(path, `Expected an array with ${min} to ${max} items.`);
  return value;
}

function requireRecord(value: unknown, path: string): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) invalid(path, "Expected a JSON object.");
  return value as Record<string, unknown>;
}

function requireString(value: unknown, path: string): string {
  if (typeof value !== "string") invalid(path, "Expected a string.");
  return value;
}

function requireFinite(value: unknown, path: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) invalid(path, "Expected a finite number.");
  return value;
}

function requirePositive(value: unknown, path: string): number {
  const number = requireFinite(value, path);
  if (number <= 0) invalid(path, "Value must be greater than zero.");
  return number;
}

function requireBoolean(value: unknown, path: string): boolean {
  if (typeof value !== "boolean") invalid(path, "Expected true or false.");
  return value;
}

function requireEnum<T extends string>(value: unknown, options: readonly T[], path: string): T {
  if (typeof value !== "string" || !options.includes(value as T)) invalid(path, `Expected one of: ${options.join(", ")}.`);
  return value as T;
}

function fieldFromMessage(message: string): string {
  const match = message.match(/\b(image|media|file|youtube|recordings|opacity|frameHidden|pdfZoom|scale|type|taskMemory|task|importance|purposes?|moods?|color|accentColor|glow|time|embedSections|smoothLineAnchors|zoneId|scope|tiers|listItems|source|randomPick|customMarks|message|name|id|width|height|x|y)\b/i);
  return match?.[1] ?? "data";
}

function invalid(field: string, message: string): never {
  throw new McpError("invalid_params", `${field}: ${message}`);
}
