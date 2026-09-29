import { screenToWorld, type Point } from "../board/cameraMath";
import { camera, viewport } from "../board/camera.svelte";
import { grid } from "../board/grid.svelte";
import { execute, type HistoryCommand } from "../history/history.svelte";
import { addLink, links, linksOf, removeLink } from "../model/links.svelte";
import { pairKey, type Link } from "../model/link";
import { addNote, board, orderIndex, removeNote, updateNote } from "../model/board.svelte";
import { newId, R5_BASE_WIDTHS, type Note } from "../model/note";
import { editing } from "../notes/editing.svelte";
import { creationObstacleForNote, estimatedCreationHeight, nearestFreeNoteCenter, notePositionAt } from "../notes/creationPosition";
import { measuredHeights } from "../notes/layout.svelte";
import { uniqueName } from "../notes/naming";
import { defaultMessageData } from "../messages/data";
import { copyTimeForHost, copyEmbedSections, type EmbedSectionState } from "./data";
import { canInsertCombo, nextSectionState, planComboInsertion, type ComboSection } from "./logic";

export function comboInsertCommand(sourceId: string, hostId: string): HistoryCommand | null {
  const source = board.notes[sourceId];
  const host = board.notes[hostId];
  const plan = source && host ? planComboInsertion(host, source) : null;
  if (!source || !host || !plan) return null;

  const sourceBefore = copyNote(source);
  const hostBefore = copyNote(host);
  const sourceIndex = orderIndex(source.id);
  const previousEditing = editing.noteId;
  const sourceLinks = linksOf(source.id).map(copyLink);
  const sourceLinkIds = new Set(sourceLinks.map((link) => link.id));
  const occupiedPairs = new Set(Object.values(links.byId)
    .filter((link) => !sourceLinkIds.has(link.id))
    .map((link) => pairKey(link.from, link.to)));
  const linksAfter = sourceLinks.flatMap((link) => {
    const from = link.from === source.id ? host.id : link.from;
    const to = link.to === source.id ? host.id : link.to;
    if (from === to) return [];
    const pair = pairKey(from, to);
    if (occupiedPairs.has(pair)) return [];
    occupiedPairs.add(pair);
    return [{ ...link, from, to }];
  });
  const { hostFields, ...plannedHost } = plan;
  const hostAfter: Note = {
    ...hostBefore,
    ...hostFields,
    ...plannedHost,
    time: plan.time ? copyTimeForHost(plan.type, plan.time) : undefined,
    message: plan.message ? { ...plan.message } : undefined,
    embedSections: copyEmbedSections(plan.embedSections),
  };
  const label = comboInsertionLabel(source);

  return {
    label,
    target: host.name,
    do: () => {
      applyNote(host.id, hostAfter);
      for (const link of sourceLinks) removeLink(link.id);
      removeNote(source.id);
      for (const link of linksAfter) addLink(copyLink(link));
      if (editing.noteId === source.id) editing.noteId = null;
    },
    undo: () => {
      applyNote(host.id, hostBefore);
      for (const link of linksAfter) removeLink(link.id);
      addNote(copyNote(sourceBefore), sourceIndex);
      for (const link of sourceLinks) addLink(copyLink(link));
      editing.noteId = previousEditing;
    },
  };
}

export function insertComboPart(sourceId: string, hostId: string): boolean {
  const command = comboInsertCommand(sourceId, hostId);
  if (!command) return false;
  execute(command);
  return true;
}

export function updateEmbeddedMessageSettings(noteId: string, patch: Partial<NonNullable<Note["message"]>>): boolean {
  const note = board.notes[noteId];
  if (!note) return false;
  const before = note.message ? { ...note.message } : undefined;
  const after = { ...(before ?? defaultMessageData()), ...patch };
  if (before?.sound === after.sound && before?.overhive === after.overhive) return false;
  execute({
    label: "Edit message settings",
    target: note.name,
    do: () => updateNote(noteId, { message: { ...after } }),
    undo: () => updateNote(noteId, { message: before ? { ...before } : undefined }),
  });
  return true;
}

/** Section expansion is saved with the host but is view state, so it does not add an Undo step. */
export function toggleEmbeddedSection(noteId: string, section: ComboSection): void {
  const note = board.notes[noteId];
  if (!note) return;
  updateNote(noteId, { embedSections: nextSectionState(note.embedSections, section) });
}

export function extractComboPart(noteId: string, section: ComboSection, worldPoint: Point): boolean {
  const host = board.notes[noteId];
  if (!host || section === "message" && !host.message || section === "time" && !host.time) return false;

  const before = copyNote(host);
  const id = newId();
  const type = section;
  const text = section === "message" ? host.text : "";
  const width = R5_BASE_WIDTHS[type];
  const height = estimatedCreationHeight({ type, width, height: null, text });
  const center = nearestFreeNoteCenter(
    worldPoint,
    width,
    height,
    Object.values(board.notes).map((note) => creationObstacleForNote(note, measuredHeights[note.id])),
    grid.snap,
    grid.step,
  );
  const position = notePositionAt(center, width, height, grid.snap, grid.step);
  const node: Note = {
    id,
    type,
    name: uniqueName(section === "message" ? "Message" : "Time", Object.values(board.notes).map((note) => note.name)),
    text,
    ...position,
    width,
    height: null,
    createdAt: Date.now(),
    ...(section === "message" ? { message: { ...(host.message ?? defaultMessageData()) } } : {
      time: copyTimeForHost("time", host.time),
    }),
  };
  const hostAfter = copyNote(host);
  if (section === "message") {
    hostAfter.message = undefined;
    if (host.type === "message") {
      hostAfter.type = "time";
      hostAfter.text = "";
      hostAfter.name = uniqueName("Time", Object.values(board.notes).filter((note) => note.id !== host.id).map((note) => note.name));
    }
  } else {
    hostAfter.time = undefined;
  }
  hostAfter.embedSections = remainingSections(hostAfter);

  const link: Link = {
    id: newId(),
    from: linkFrom(hostAfter, node, section),
    to: linkTo(hostAfter, node, section),
    kind: "strong",
    shape: "base",
  };
  const sourceIndex = board.order.length;
  const previousEditing = editing.noteId;

  execute({
    label: `Extract ${section === "message" ? "Message" : "Time"}`,
    target: host.name,
    do: () => {
      applyNote(host.id, hostAfter);
      addNote(node, sourceIndex);
      addLink(link);
    },
    undo: () => {
      removeLink(link.id);
      removeNote(node.id);
      applyNote(host.id, before);
      editing.noteId = previousEditing;
    },
  });
  return true;
}

export function worldPointFromClient(clientX: number, clientY: number): Point | null {
  const boardElement = document.querySelector<HTMLElement>(".board");
  if (!boardElement) return null;
  const rect = boardElement.getBoundingClientRect();
  return screenToWorld(camera, viewport, { x: clientX - rect.left, y: clientY - rect.top });
}

export function canHostCombo(sourceId: string, hostId: string): boolean {
  return canInsertCombo(board.notes[sourceId], board.notes[hostId]);
}

function linkFrom(host: Note, extracted: Note, section: ComboSection): string {
  if (section === "message") return host.id;
  return host.task || !host.message && host.type !== "message" ? host.id : extracted.id;
}

function linkTo(host: Note, extracted: Note, section: ComboSection): string {
  if (section === "message") return extracted.id;
  return host.task || !host.message && host.type !== "message" ? extracted.id : host.id;
}

function remainingSections(note: Note): EmbedSectionState | undefined {
  const state = {
    ...(note.message && note.type !== "message" && note.embedSections?.message !== undefined
      ? { message: note.embedSections.message } : {}),
    ...(note.time && note.type !== "time" && note.embedSections?.time !== undefined
      ? { time: note.embedSections.time } : {}),
  };
  return Object.keys(state).length > 0 ? state : undefined;
}

function applyNote(id: string, note: Note): void {
  const current = board.notes[id];
  if (!current) return;
  Object.assign(current, copyNote(note));
}

function copyNote(note: Note): Note {
  return {
    ...note,
    ...(note.time ? { time: copyTimeForHost(note.type, note.time) } : { time: undefined }),
    ...(note.message ? { message: { ...note.message } } : { message: undefined }),
    ...(note.embedSections ? { embedSections: copyEmbedSections(note.embedSections) } : { embedSections: undefined }),
  };
}

function copyLink(link: Link): Link {
  return {
    ...link,
    ...(link.fromAnchor ? { fromAnchor: { ...link.fromAnchor } } : {}),
    ...(link.toAnchor ? { toAnchor: { ...link.toAnchor } } : {}),
  };
}

function comboInsertionLabel(source: Note): string {
  const textHost = source.type === "note" || source.type === "pro" || source.type === "con"
    ? source.task ? "Task" : "Note"
    : null;
  const parts = [
    textHost,
    source.type === "message" || source.message ? "Message" : null,
    source.type === "time" || source.time ? "Time" : null,
  ].filter((part): part is string => part !== null);
  return `Insert ${parts.join(" and ")}`;
}
