import { board, onBoardMutation } from "../model/board.svelte";
import { links, linksOf, onLinksMutation } from "../model/links.svelte";
import type { Note } from "../model/note";
import type { NodeScope } from "../model/nodeData";
import { beaconDescendants } from "../beacons/coverage";
import { scopeKey } from "./scopeLogic";

type SummaryKind = "progress" | "text";

interface NoteInputs {
  zoneId: string | null;
  hasTask: boolean;
  isTextNote: boolean;
  progress: string;
  text: string;
}

const revisions = $state<Record<string, number>>({ "progress:board": 0, "text:board": 0 });
const progressNoteRevision = $state<Record<string, number>>({});
const textNoteRevision = $state<Record<string, number>>({});
const boardGeneration = $state({ progress: 0, text: 0 });
const progressLinkRevision = $state({ value: 0 });
const beaconLinkRevision = $state({ value: 0 });
const linkGeneration = $state({ value: 0 });
const linkNoteRevision = $state<Record<string, number>>({});
const previousInputs = new Map<string, NoteInputs>();
const previousLinkInputs = new Map<string, { from: string; to: string; kind: string }>();

for (const link of Object.values(links.byId)) {
  previousLinkInputs.set(link.id, { from: link.from, to: link.to, kind: link.kind });
}

onLinksMutation((ids) => {
  if (ids === null) {
    previousLinkInputs.clear();
    for (const link of Object.values(links.byId)) {
      previousLinkInputs.set(link.id, { from: link.from, to: link.to, kind: link.kind });
    }
    progressLinkRevision.value += 1;
    beaconLinkRevision.value += 1;
    linkGeneration.value += 1;
    return;
  }

  let taskImportanceChanged = false;
  let strongTopologyChanged = false;
  for (const id of ids) {
    const previous = previousLinkInputs.get(id);
    const link = links.byId[id];
    const current = link ? { from: link.from, to: link.to, kind: link.kind } : undefined;
    if (current) previousLinkInputs.set(id, current);
    else previousLinkInputs.delete(id);
    if (sameLinkInput(previous, current)) continue;

    const edges = [previous, current].filter((edge): edge is NonNullable<typeof edge> => Boolean(edge));
    for (const edge of edges) {
      linkNoteRevision[edge.from] = (linkNoteRevision[edge.from] ?? 0) + 1;
      linkNoteRevision[edge.to] = (linkNoteRevision[edge.to] ?? 0) + 1;
    }
    if (edges.some((edge) => edge.kind === "strong")) strongTopologyChanged = true;
    if (edges.some((edge) => edge.kind === "strong" && edgeAffectsTaskImportance(edge))) taskImportanceChanged = true;
  }
  if (taskImportanceChanged) progressLinkRevision.value += 1;
  if (strongTopologyChanged) beaconLinkRevision.value += 1;
});

/** Reactive per-note link revision for views that read the O(degree) `linksOf` adjacency API. */
export function reactiveLinkRevisionFor(noteId: string): string {
  return `${linkGeneration.value}:${linkNoteRevision[noteId] ?? 0}`;
}

function sameLinkInput(
  left: { from: string; to: string; kind: string } | undefined,
  right: { from: string; to: string; kind: string } | undefined,
): boolean {
  return left === right || Boolean(left && right && left.from === right.from && left.to === right.to && left.kind === right.kind);
}

function edgeAffectsTaskImportance(edge: { from: string; to: string }): boolean {
  const from = board.notes[edge.from];
  const to = board.notes[edge.to];
  return Boolean(from?.type === "importance" && to?.task || to?.type === "importance" && from?.task);
}

function inputFor(note: Note | undefined): NoteInputs | null {
  if (!note) return null;
  const textNote = note.type === "note" || note.type === "pro" || note.type === "con";
  return {
    zoneId: note.zoneId ?? null,
    hasTask: Boolean(note.task),
    isTextNote: textNote,
    progress: JSON.stringify([Boolean(note.task), note.task?.done === true, note.task ? note.importance ?? null : null,
      note.type === "importance" ? note.importance ?? null : null]),
    text: textNote ? JSON.stringify([note.type, note.text ?? ""]) : "",
  };
}

function bump(kind: SummaryKind, zoneId: string | null): void {
  const boardKey = `${kind}:board`;
  revisions[boardKey] = (revisions[boardKey] ?? 0) + 1;
  if (zoneId) {
    const zoneKey = `${kind}:zone:${zoneId}`;
    revisions[zoneKey] = (revisions[zoneKey] ?? 0) + 1;
  }
}

function bumpNote(kind: SummaryKind, id: string): void {
  const target = kind === "progress" ? progressNoteRevision : textNoteRevision;
  target[id] = (target[id] ?? 0) + 1;
}

function refreshSnapshot(id: string): void {
  const previous = previousInputs.get(id) ?? null;
  const note = board.notes[id];
  const current = inputFor(note);
  if (sameInputs(previous, current)) return;

  if (current) previousInputs.set(id, current);
  else previousInputs.delete(id);

  const membershipChanged = previous?.zoneId !== current?.zoneId;
  const progressChanged = previous?.progress !== current?.progress;
  const textChanged = previous?.text !== current?.text;
  const progressMembershipChanged = membershipChanged && Boolean(previous?.hasTask || current?.hasTask);
  const textMembershipChanged = membershipChanged && Boolean(previous?.isTextNote || current?.isTextNote);

  if (progressChanged || progressMembershipChanged) {
    if (progressChanged) bumpNote("progress", id);
    if (progressChanged && (previous?.hasTask || current?.hasTask || note?.type === "importance" || previous?.progress.includes('"importance"'))) {
      bump("progress", current?.zoneId ?? previous?.zoneId ?? null);
    }
    if (progressMembershipChanged) {
      if (previous?.zoneId) bump("progress", previous.zoneId);
      if (current?.zoneId) bump("progress", current.zoneId);
    }
  }
  if (textChanged || textMembershipChanged) {
    if (textChanged) bumpNote("text", id);
    if (textChanged && (previous?.isTextNote || current?.isTextNote)) bump("text", current?.zoneId ?? previous?.zoneId ?? null);
    if (textMembershipChanged) {
      if (previous?.zoneId) bump("text", previous.zoneId);
      if (current?.zoneId) bump("text", current.zoneId);
    }
  }

  // An Importance module changes the effective weight of its directly linked task-bearing notes.
  if (progressChanged && (note?.type === "importance" || previous?.progress.includes('"importance"'))) {
    for (const link of linksOf(id)) {
      if (link.kind !== "strong") continue;
      const neighbourId = link.from === id ? link.to : link.from;
      const neighbour = board.notes[neighbourId];
      if (!neighbour?.task) continue;
      bumpNote("progress", neighbourId);
      bump("progress", neighbour.zoneId ?? null);
    }
  }
}

function sameInputs(left: NoteInputs | null, right: NoteInputs | null): boolean {
  return left === right || Boolean(left && right && left.zoneId === right.zoneId &&
    left.hasTask === right.hasTask && left.isTextNote === right.isTextNote &&
    left.progress === right.progress && left.text === right.text);
}

function onMutation(ids: readonly string[] | null): void {
  if (ids === null) {
    previousInputs.clear();
    for (const note of Object.values(board.notes)) {
      const inputs = inputFor(note);
      if (inputs) previousInputs.set(note.id, inputs);
    }
    revisions["progress:board"] = (revisions["progress:board"] ?? 0) + 1;
    revisions["text:board"] = (revisions["text:board"] ?? 0) + 1;
    for (const key of Object.keys(revisions)) {
      if (key.startsWith("progress:zone:") || key.startsWith("text:zone:")) revisions[key] += 1;
    }
    progressNoteRevision["*"] = (progressNoteRevision["*"] ?? 0) + 1;
    textNoteRevision["*"] = (textNoteRevision["*"] ?? 0) + 1;
    boardGeneration.progress += 1;
    boardGeneration.text += 1;
    return;
  }
  for (const id of ids) refreshSnapshot(id);
}

onBoardMutation(onMutation);

/** Cheap revision for the inputs that change a scoped Progress or text Statistics summary. */
export function scopeSummaryRevision(scope: NodeScope, kind: SummaryKind): string {
  const key = `${kind}:${scopeKey(scope)}`;
  if (scope.kind !== "beacon") {
    const current = String(revisions[key] ?? 0);
    return kind === "progress" ? `${current}:${progressLinkRevision.value}` : current;
  }

  // Descendant membership is read reactively and cached by the coverage graph. Per-note versions
  // make changes to a task, its importance source, or its text visible without a board-wide scan.
  const members = [...beaconDescendants(scope.id)].sort();
  const memberVersions = kind === "progress" ? progressNoteRevision : textNoteRevision;
  const membershipVersion = members.map((id) => `${id}:${memberVersions[id] ?? 0}`).join("|");
  return `${boardGeneration[kind]}:${beaconLinkRevision.value}:${membershipVersion}`;
}

/** Scope membership for content summaries; zone membership is already persisted on each note. */
export function resolveSummaryMembers(scope: NodeScope): Set<string> {
  if (scope.kind === "zone") {
    return new Set(board.order.filter((id) => board.notes[id]?.zoneId === scope.id));
  }
  return new Set(scope.kind === "beacon" ? beaconDescendants(scope.id) : board.order);
}
