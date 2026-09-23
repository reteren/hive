import { camera, viewport } from "../board/camera.svelte";
import type { Point } from "../board/cameraMath";
import { execute } from "../history/history.svelte";
import { addNote, board, orderIndex, removeNote, updateNote } from "../model/board.svelte";
import { newId, type ImportanceLevel, type Note, type PurposeKind } from "../model/note";
import { addLink, links, linksOf, removeLink, replaceLinks } from "../model/links.svelte";
import type { Link } from "../model/link";
import { grid } from "../board/grid.svelte";
import { screenToWorld } from "../board/cameraMath";
import { noteBounds } from "../notes/layout.svelte";
import { uniqueName } from "../notes/naming";
import { notePositionAt } from "../notes/creationPosition";
import { editing } from "../notes/editing.svelte";
import { tool } from "../tools/tool.svelte";
import {
  createImportanceCommand,
  createPurposeSelectionCommand,
  createPurposeToggleCommand,
  effectiveImportanceFor,
  effectivePurposesFor,
  linkedImportanceSourceFor,
  linkedPurposesFor,
  MODULE_NOTE_HEIGHT,
  MODULE_NOTE_WIDTH,
  type ModuleDataPatch,
} from "./moduleLogic";
import { closeModulePicker, openModulePicker } from "./pickerState.svelte";

export { closeModulePicker, openModulePicker };

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

export function isLinkedImportance(noteId: string): boolean {
  return linkedImportanceSourceFor(noteId, board.notes, Object.values(links.byId)) !== null;
}

export function linkedPurposes(noteId: string): PurposeKind[] {
  return linkedPurposesFor(noteId, board.notes, Object.values(links.byId));
}

export function setImportance(noteId: string, level: ImportanceLevel | null): void {
  const note = board.notes[noteId];
  if (!note) return;
  const command = createImportanceCommand(note, level, writeModulePatch);
  if (command) execute(command);
  closeModulePicker();
}

export function togglePurpose(noteId: string, purpose: PurposeKind): void {
  const note = board.notes[noteId];
  if (!note) return;
  const command = createPurposeToggleCommand(note, purpose, writeModulePatch);
  if (command) execute(command);
}

export function setStandalonePurpose(noteId: string, purpose: PurposeKind): void {
  const note = board.notes[noteId];
  if (!note || note.type !== "purpose") return;
  const command = createPurposeSelectionCommand(note, purpose, writeModulePatch);
  if (command) execute(command);
  closeModulePicker();
}

/** Update the board-space target highlight while an external module is being dragged. */
export function updateModuleDropPreview(moduleId: string, worldPoint: Point): void {
  const module = board.notes[moduleId];
  const target = module && isExternalModule(module) ? targetAtPoint(worldPoint, moduleId) : null;
  const reason = target && module ? insertionRefusal(module, target) : null;
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

  const refusal = insertionRefusal(module, target);
  if (refusal) {
    showModuleFeedback(target.id, refusal);
    clearModuleDropPreview();
    return false;
  }

  const moduleSnapshot = copyNote(module);
  const attachedLinks = linksOf(moduleId).map(copyLink);
  const allLinksBefore = Object.values(links.byId).map(copyLink);
  const moduleIndex = orderIndex(moduleId);
  const previousEditing = editing.noteId;
  const previousImportance = target.importance;
  const previousPurposes = target.purposes ? [...target.purposes] : target.purposes;

  if (module.type === "importance") {
    const level = module.importance;
    if (!level) return false;
    execute({
      label: "Insert Importance",
      target: target.name,
      do: () => {
        writeModulePatch(target.id, { importance: level });
        for (const link of attachedLinks) removeLink(link.id);
        removeNote(module.id);
        if (editing.noteId === module.id) editing.noteId = null;
      },
      undo: () => {
        writeModulePatch(target.id, { importance: previousImportance });
        addNote(moduleSnapshot, moduleIndex);
        replaceLinks(allLinksBefore.map(copyLink));
        if (previousEditing === module.id) editing.noteId = previousEditing;
      },
    });
  } else {
    const purposes = module.purposes ?? [];
    if (purposes.length === 0) return false;
    const nextPurposes = [...(target.purposes ?? [])];
    for (const purpose of purposes) {
      if (!nextPurposes.includes(purpose)) nextPurposes.push(purpose);
    }
    execute({
      label: "Insert Purpose",
      target: target.name,
      do: () => {
        writeModulePatch(target.id, { purposes: nextPurposes });
        for (const link of attachedLinks) removeLink(link.id);
        removeNote(module.id);
        if (editing.noteId === module.id) editing.noteId = null;
      },
      undo: () => {
        writeModulePatch(target.id, { purposes: previousPurposes });
        addNote(moduleSnapshot, moduleIndex);
        replaceLinks(allLinksBefore.map(copyLink));
        if (previousEditing === module.id) editing.noteId = previousEditing;
      },
    });
  }

  clearModuleDropPreview();
  return true;
}

/** Drag an embedded chip out to a new external module with its strong link to the old note. */
export function extractModuleFromNote(
  noteId: string,
  kind: "importance" | "purpose",
  value: ImportanceLevel | PurposeKind,
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
  } else {
    const purpose = value as PurposeKind;
    const current = target.purposes ?? [];
    if (!current.includes(purpose)) return false;
    nextPatch = { purposes: current.filter((item) => item !== purpose) };
    module = createExternalModule("purpose", purpose, worldPoint);
  }

  const noteIndex = board.order.length;
  const link: Link = {
    id: newId(),
    from: module.id,
    to: target.id,
    kind: "strong",
    shape: tool.lineShape,
  };
  const previousImportance = target.importance;
  const previousPurposes = target.purposes ? [...target.purposes] : target.purposes;
  const previousEditing = editing.noteId;

  execute({
    label: kind === "importance" ? "Extract Importance" : "Extract Purpose",
    target: target.name,
    do: () => {
      writeModulePatch(target.id, nextPatch);
      addNote(module, noteIndex);
      addLink(link);
    },
    undo: () => {
      removeLink(link.id);
      removeNote(module.id);
      writeModulePatch(target.id, { importance: previousImportance, purposes: previousPurposes });
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
  kind: "importance" | "purpose",
  value: ImportanceLevel | PurposeKind,
  worldPoint: Point,
): Note {
  const id = newId();
  const position = notePositionAt(worldPoint, MODULE_NOTE_WIDTH, MODULE_NOTE_HEIGHT, grid.snap, grid.step);
  const existingNames = Object.values(board.notes).map((note) => note.name);
  const name = uniqueName(kind === "importance" ? "Importance" : "Purpose", existingNames);
  return {
    id,
    type: kind,
    name,
    text: "",
    x: position.x,
    y: position.y,
    width: MODULE_NOTE_WIDTH,
    height: MODULE_NOTE_HEIGHT,
    createdAt: Date.now(),
    ...(kind === "importance" ? { importance: value as ImportanceLevel } : { purposes: [value as PurposeKind] }),
  };
}

function targetAtPoint(point: Point, excludedId: string): Note | null {
  for (let index = board.order.length - 1; index >= 0; index -= 1) {
    const note = board.notes[board.order[index]];
    if (!note || note.id === excludedId || !isAssignableNote(note)) continue;
    const bounds = noteBounds(note);
    if (point.x >= bounds.x && point.x <= bounds.x + bounds.width &&
      point.y >= bounds.y && point.y <= bounds.y + bounds.height) return note;
  }
  return null;
}

function insertionRefusal(module: Note, target: Note): string | null {
  if (module.type === "importance") {
    if (!module.importance) return "Importance module has no level.";
    if (target.importance) return "This note already has an Importance source.";
    if (hasExternalImportance(target.id, module.id)) return "This note already has an Importance source.";
  } else if (module.type === "purpose" && !module.purposes?.length) {
    return "Purpose module has no label.";
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
  return note.type === "importance" || note.type === "purpose";
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
}

function copyNote(note: Note): Note {
  return {
    ...note,
    task: note.task ? { ...note.task } : note.task,
    purposes: note.purposes ? [...note.purposes] : note.purposes,
  };
}

function copyLink(link: Link): Link {
  return {
    ...link,
    fromAnchor: link.fromAnchor ? { ...link.fromAnchor } : link.fromAnchor,
    toAnchor: link.toAnchor ? { ...link.toAnchor } : link.toAnchor,
  };
}
