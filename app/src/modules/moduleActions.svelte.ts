import { camera, viewport } from "../board/camera.svelte";
import type { Point } from "../board/cameraMath";
import { execute } from "../history/history.svelte";
import { addNote, board, orderIndex, removeNote, updateNote } from "../model/board.svelte";
import { newId, type ImportanceLevel, type MoodKind, type Note, type PurposeKind } from "../model/note";
import { addLink, links, linksOf, removeLink } from "../model/links.svelte";
import type { Link } from "../model/link";
import { grid } from "../board/grid.svelte";
import { screenToWorld } from "../board/cameraMath";
import { measuredHeights, noteBounds } from "../notes/layout.svelte";
import { uniqueName } from "../notes/naming";
import {
  creationObstacleForNote,
  estimatedCreationHeight,
  nearestFreeNoteCenter,
  notePositionAt,
} from "../notes/creationPosition";
import { editing } from "../notes/editing.svelte";
import { selection } from "../selection/selection.svelte";
import { planModuleMerge } from "./moduleMerge";
import {
  createImportanceCommand,
  createMoodToggleCommand,
  createPurposeToggleCommand,
  effectiveImportanceFor,
  effectiveMoodsFor,
  effectivePurposesFor,
  linkedImportanceSourceFor,
  linkedMoodsFor,
  linkedPurposesFor,
  MODULE_NOTE_HEIGHT,
  MODULE_NOTE_WIDTH,
  type ExternalModuleKind,
  type ModuleArrayKind,
  type ModuleDataPatch,
} from "./moduleLogic";
import { closeModulePicker, openModulePicker, toggleModulePicker } from "./pickerState.svelte";

export { closeModulePicker, openModulePicker, toggleModulePicker };

export const moduleDropPreview = $state({
  moduleId: null as string | null,
  targetId: null as string | null,
  allowed: false,
  reason: null as string | null,
});

export const moduleFeedback = $state({
  noteId: null as string | null,
  message: null as string | null,
});

let feedbackTimer: ReturnType<typeof setTimeout> | undefined;

export function effectiveImportance(noteId: string): ImportanceLevel | null {
  return effectiveImportanceFor(noteId, board.notes, Object.values(links.byId));
}

export function effectivePurposes(noteId: string): PurposeKind[] {
  return effectivePurposesFor(noteId, board.notes, Object.values(links.byId));
}

export function effectiveMoods(noteId: string): MoodKind[] {
  return effectiveMoodsFor(noteId, board.notes, Object.values(links.byId));
}

export function isLinkedImportance(noteId: string): boolean {
  return linkedImportanceSourceFor(noteId, board.notes, Object.values(links.byId)) !== null;
}

export function linkedImportanceSource(noteId: string): Note | null {
  const sourceId = linkedImportanceSourceFor(noteId, board.notes, Object.values(links.byId));
  const source = sourceId ? board.notes[sourceId] : undefined;
  return source?.type === "importance" ? source : null;
}

export function linkedPurposes(noteId: string): PurposeKind[] {
  return linkedPurposesFor(noteId, board.notes, Object.values(links.byId));
}

export function linkedMoods(noteId: string): MoodKind[] {
  return linkedMoodsFor(noteId, board.notes, Object.values(links.byId));
}

export function setImportance(noteId: string, level: ImportanceLevel | null): void {
  const note = board.notes[noteId];
  if (!note) return;
  if (linkedImportanceSource(noteId)) {
    showModuleFeedback(noteId, "Change the linked Importance or make it local first.");
    return;
  }
  const command = createImportanceCommand(note, level, writeModulePatch);
  if (command) execute(command);
  closeModulePicker();
}

/** Change the shared external source; every strongly linked target sees the new level. */
export function setLinkedImportance(noteId: string, level: ImportanceLevel): boolean {
  const source = linkedImportanceSource(noteId);
  if (!source) return false;
  const command = createImportanceCommand(source, level, writeModulePatch);
  if (command) execute(command);
  closeModulePicker();
  return true;
}

/** Detach one target from its shared source and store the selected level on that target. */
export function makeImportanceLocal(noteId: string, level: ImportanceLevel): boolean {
  const target = board.notes[noteId];
  const source = linkedImportanceSource(noteId);
  if (!target || !source) return false;

  const sourceLinks = linksOf(noteId).filter((link) =>
    link.kind === "strong" && ((link.from === noteId && link.to === source.id) ||
      (link.to === noteId && link.from === source.id)),
  ).map(copyLink);
  if (sourceLinks.length === 0) return false;

  const previousImportance = target.importance;
  execute({
    label: "Make Importance Local",
    target: target.name,
    do: () => {
      for (const link of sourceLinks) removeLink(link.id);
      writeModulePatch(noteId, { importance: level });
    },
    undo: () => {
      writeModulePatch(noteId, { importance: previousImportance });
      for (const link of sourceLinks) addLink(copyLink(link));
    },
  });
  closeModulePicker();
  return true;
}

export function togglePurpose(noteId: string, purpose: PurposeKind): void {
  const note = board.notes[noteId];
  if (!note) return;
  const command = createPurposeToggleCommand(note, purpose, writeModulePatch);
  if (command) execute(command);
}

export function toggleMood(noteId: string, mood: MoodKind): void {
  const note = board.notes[noteId];
  if (!note) return;
  const command = createMoodToggleCommand(note, mood, writeModulePatch);
  if (command) execute(command);
}

/** Update the board-space target highlight while an external module is being dragged. */
export function updateModuleDropPreview(moduleId: string, worldPoint: Point): void {
  const module = board.notes[moduleId];
  const target = module && isExternalModule(module) ? targetAtPoint(worldPoint, moduleId) : null;
  const reason = target && module ? dropRefusal(module, target) : null;
  moduleDropPreview.moduleId = moduleId;
  moduleDropPreview.targetId = target?.id ?? null;
  moduleDropPreview.allowed = Boolean(target && !reason);
  moduleDropPreview.reason = reason;
}

export function clearModuleDropPreview(): void {
  moduleDropPreview.moduleId = null;
  moduleDropPreview.targetId = null;
  moduleDropPreview.allowed = false;
  moduleDropPreview.reason = null;
}

/** Insert an external module into the note under the drop point as one reversible operation. */
export function tryInsertModuleOnDrop(moduleId: string, worldPoint: Point): boolean {
  const module = board.notes[moduleId];
  const target = module && isExternalModule(module) ? targetAtPoint(worldPoint, moduleId) : null;
  if (!module || !target) {
    clearModuleDropPreview();
    return false;
  }

  const refusal = dropRefusal(module, target);
  if (refusal) {
    showModuleFeedback(target.id, refusal);
    clearModuleDropPreview();
    return false;
  }

  if (module.type === target.type && (module.type === "purpose" || module.type === "mood")) {
    return mergeArrayModuleNodes(module, target);
  }

  const moduleSnapshot = copyNote(module);
  const attachedLinks = linksOf(moduleId).map(copyLink);
  const targetLinks = attachedLinks.filter((link) =>
    (link.from === moduleId && link.to === target.id) ||
    (link.to === moduleId && link.from === target.id),
  );
  const targetLinkIds = new Set(targetLinks.map((link) => link.id));
  const remainingLinks = attachedLinks.filter((link) => !targetLinkIds.has(link.id));
  const hasRemainingTargets = remainingLinks.some((link) => {
    const otherId = link.from === moduleId ? link.to : link.from;
    const other = board.notes[otherId];
    return Boolean(other && isAssignableNote(other));
  });
  const deleteModule = !hasRemainingTargets;
  const linksToRemove = deleteModule ? attachedLinks : targetLinks;
  const moduleIndex = orderIndex(moduleId);
  const previousEditing = editing.noteId;
  const previousPatch = copyModulePatch(target);
  const nextPatch = valuePatchForInsertion(module, target);
  if (!nextPatch) return false;
  const moduleLabel = kindLabel(module.type as ExternalModuleKind);

  execute({
    label: `Insert ${moduleLabel}`,
    target: target.name,
    do: () => {
      writeModulePatch(target.id, nextPatch);
      for (const link of linksToRemove) removeLink(link.id);
      if (deleteModule) {
        removeNote(module.id);
        if (editing.noteId === module.id) editing.noteId = null;
      }
    },
    undo: () => {
      writeModulePatch(target.id, previousPatch);
      if (deleteModule) addNote(moduleSnapshot, moduleIndex);
      for (const link of linksToRemove) addLink(copyLink(link));
      if (deleteModule && previousEditing === module.id) editing.noteId = previousEditing;
    },
  });

  clearModuleDropPreview();
  return true;
}

function mergeArrayModuleNodes(source: Note, target: Note): boolean {
  const result = planModuleMerge(source, target, Object.values(links.byId), board.notes);
  if (!result.ok) {
    showModuleFeedback(target.id, result.reason);
    clearModuleDropPreview();
    return false;
  }
  const { plan } = result;
  const sourceSnapshot = copyNote(source);
  const sourceIndex = orderIndex(source.id);
  const previousValues = plan.field === "purposes"
    ? target.purposes ? [...target.purposes] : target.purposes
    : target.moods ? [...target.moods] : target.moods;
  const previousSelection = [...selection.ids];
  const previousPrimary = selection.primaryId;
  const previousEditing = editing.noteId;
  const nextSelection = [...new Set(previousSelection.map((id) => id === source.id ? target.id : id))];

  execute({
    label: `Merge ${source.type === "purpose" ? "Purpose" : "Mood"}`,
    target: target.name,
    do: () => {
      for (const link of plan.removedLinks) removeLink(link.id);
      writeModulePatch(target.id, { [plan.field]: plan.values });
      removeNote(source.id);
      for (const link of plan.addedLinks) addLink(copyLink(link));
      selection.ids = nextSelection;
      selection.primaryId = previousPrimary === source.id ? target.id : previousPrimary;
      if (editing.noteId === source.id) editing.noteId = null;
      closeModulePicker();
    },
    undo: () => {
      for (const link of plan.addedLinks) removeLink(link.id);
      addNote(copyNote(sourceSnapshot), sourceIndex);
      writeModulePatch(target.id, { [plan.field]: previousValues });
      for (const link of plan.removedLinks) addLink(copyLink(link));
      selection.ids = [...previousSelection];
      selection.primaryId = previousPrimary;
      editing.noteId = previousEditing;
    },
  });
  clearModuleDropPreview();
  return true;
}

/** Drag an embedded chip out to a new external module with its strong link to the old note. */
export function extractModuleFromNote(
  noteId: string,
  kind: ExternalModuleKind,
  value: ImportanceLevel | PurposeKind | MoodKind,
  worldPoint: Point,
): boolean {
  const target = board.notes[noteId];
  if (!target || !isAssignableNote(target)) return false;

  let nextPatch: ModuleDataPatch;
  let module: Note;
  if (kind === "importance") {
    if (!target.importance || target.importance !== value) return false;
    if (hasExternalImportance(noteId)) {
      showModuleFeedback(noteId, "This note already has a linked Importance source.");
      return false;
    }
    const level = value as ImportanceLevel;
    nextPatch = { importance: null };
    module = createExternalModule("importance", level, worldPoint);
  } else if (kind === "purpose") {
    const purpose = value as PurposeKind;
    const current = target.purposes ?? [];
    if (!current.includes(purpose)) return false;
    nextPatch = { purposes: current.filter((item) => item !== purpose) };
    module = createExternalModule("purpose", purpose, worldPoint);
  } else {
    const mood = value as MoodKind;
    const current = target.moods ?? [];
    if (!current.includes(mood)) return false;
    nextPatch = { moods: current.filter((item) => item !== mood) };
    module = createExternalModule("mood", mood, worldPoint);
  }

  const noteIndex = board.order.length;
  const link: Link = {
    id: newId(),
    from: module.id,
    to: target.id,
    kind: "strong",
    shape: "base",
  };
  const previousPatch = copyModulePatch(target);
  const previousEditing = editing.noteId;

  execute({
    label: `Extract ${kindLabel(kind)}`,
    target: target.name,
    do: () => {
      writeModulePatch(target.id, nextPatch);
      addNote(module, noteIndex);
      addLink(link);
    },
    undo: () => {
      removeLink(link.id);
      removeNote(module.id);
      writeModulePatch(target.id, previousPatch);
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

export function showModuleFeedback(noteId: string, message: string): void {
  if (feedbackTimer !== undefined) clearTimeout(feedbackTimer);
  moduleFeedback.noteId = noteId;
  moduleFeedback.message = message;
  feedbackTimer = setTimeout(() => {
    moduleFeedback.noteId = null;
    moduleFeedback.message = null;
    feedbackTimer = undefined;
  }, 1_800);
}

function createExternalModule(
  kind: ExternalModuleKind,
  value: ImportanceLevel | PurposeKind | MoodKind,
  worldPoint: Point,
): Note {
  const id = newId();
  const height = estimatedCreationHeight({
    type: kind,
    width: MODULE_NOTE_WIDTH,
    height: kind === "importance" ? MODULE_NOTE_HEIGHT : null,
    text: "",
  });
  const freeCenter = nearestFreeNoteCenter(
    worldPoint,
    MODULE_NOTE_WIDTH,
    height,
    Object.values(board.notes).map((note) => creationObstacleForNote(note, measuredHeights[note.id])),
    grid.snap,
    grid.step,
  );
  const position = notePositionAt(freeCenter, MODULE_NOTE_WIDTH, height, false, grid.step);
  const existingNames = Object.values(board.notes).map((note) => note.name);
  const name = uniqueName(kindLabel(kind), existingNames);
  return {
    id,
    type: kind,
    name,
    text: "",
    x: position.x,
    y: position.y,
    width: MODULE_NOTE_WIDTH,
    height: kind === "importance" ? MODULE_NOTE_HEIGHT : null,
    createdAt: Date.now(),
    ...(kind === "importance"
      ? { importance: value as ImportanceLevel }
      : kind === "purpose"
        ? { purposes: [value as PurposeKind] }
        : { moods: [value as MoodKind] }),
  };
}

function valuePatchForInsertion(module: Note, target: Note): ModuleDataPatch | null {
  if (module.type === "importance") {
    return module.importance ? { importance: module.importance } : null;
  }
  if (module.type === "purpose") {
    const values = module.purposes ?? [];
    if (values.length === 0) return null;
    return { purposes: appendUnique(target.purposes ?? [], values) };
  }
  if (module.type === "mood") {
    const values = module.moods ?? [];
    if (values.length === 0) return null;
    return { moods: appendUnique(target.moods ?? [], values) };
  }
  return null;
}

function appendUnique<T>(current: readonly T[], additions: readonly T[]): T[] {
  const result = [...current];
  for (const value of additions) if (!result.includes(value)) result.push(value);
  return result;
}

function copyModulePatch(note: Note): ModuleDataPatch {
  return {
    importance: note.importance,
    purposes: note.purposes ? [...note.purposes] : note.purposes,
    moods: note.moods ? [...note.moods] : note.moods,
  };
}

function kindLabel(kind: ExternalModuleKind): string {
  return kind === "importance" ? "Importance" : kind === "purpose" ? "Purpose" : "Mood";
}

function targetAtPoint(point: Point, excludedId: string): Note | null {
  for (let index = board.order.length - 1; index >= 0; index -= 1) {
    const note = board.notes[board.order[index]];
    if (!note || note.id === excludedId) continue;
    const bounds = noteBounds(note);
    if (point.x >= bounds.x && point.x <= bounds.x + bounds.width &&
      point.y >= bounds.y && point.y <= bounds.y + bounds.height) {
      return isAssignableNote(note) || note.type === "purpose" || note.type === "mood" ? note : null;
    }
  }
  return null;
}

function dropRefusal(module: Note, target: Note): string | null {
  if (module.type === target.type && (module.type === "purpose" || module.type === "mood")) {
    const result = planModuleMerge(module, target, Object.values(links.byId), board.notes);
    return result.ok ? null : result.reason;
  }
  return isAssignableNote(target) ? insertionRefusal(module, target) : "Cannot insert a module into this node.";
}

function insertionRefusal(module: Note, target: Note): string | null {
  if (module.type === "importance") {
    if (!module.importance) return "Importance module has no level.";
    if (target.importance) return "This note already has an Importance source.";
    if (hasExternalImportance(target.id, module.id)) return "This note already has an Importance source.";
  } else if (module.type === "purpose" && !module.purposes?.length) {
    return "Purpose module has no label.";
  } else if (module.type === "mood" && !module.moods?.length) {
    return "Mood module has no value.";
  }
  return null;
}

function hasExternalImportance(noteId: string, exceptModuleId?: string): boolean {
  return linksOf(noteId).some((link) => {
    if (link.kind !== "strong") return false;
    const otherId = link.from === noteId ? link.to : link.from;
    if (otherId === exceptModuleId) return false;
    const module = board.notes[otherId];
    return module?.type === "importance" && Boolean(module.importance);
  });
}

function isExternalModule(note: Note): boolean {
  return note.type === "importance" || note.type === "purpose" || note.type === "mood";
}

function isAssignableNote(note: Note): boolean {
  return note.type === "note" || note.type === "pro" || note.type === "con";
}

function writeModulePatch(noteId: string, patch: ModuleDataPatch): void {
  const note = board.notes[noteId];
  if (!note) return;

  if ("importance" in patch) {
    if (patch.importance === undefined) delete note.importance;
    else updateNote(noteId, { importance: patch.importance });
  }
  if ("purposes" in patch) {
    if (patch.purposes === undefined) delete note.purposes;
    else updateNote(noteId, { purposes: [...patch.purposes] });
  }
  if ("moods" in patch) {
    if (patch.moods === undefined) delete note.moods;
    else updateNote(noteId, { moods: [...patch.moods] });
  }
}

function copyNote(note: Note): Note {
  return {
    ...note,
    task: note.task ? { ...note.task } : note.task,
    purposes: note.purposes ? [...note.purposes] : note.purposes,
    moods: note.moods ? [...note.moods] : note.moods,
  };
}

function copyLink(link: Link): Link {
  return {
    ...link,
    fromAnchor: link.fromAnchor ? { ...link.fromAnchor } : link.fromAnchor,
    toAnchor: link.toAnchor ? { ...link.toAnchor } : link.toAnchor,
  };
}
