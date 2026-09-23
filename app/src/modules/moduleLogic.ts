import type { HistoryCommand } from "../history/historyStack";
import {
  IMPORTANCE_LEVELS,
  PURPOSE_KINDS,
  type ImportanceLevel,
  type Note,
  type PurposeKind,
} from "../model/note";
import type { Link } from "../model/link";

export interface ModuleOption {
  id: string;
  label: string;
  color: string;
  iconPath?: string;
}

export const IMPORTANCE_OPTIONS: readonly ModuleOption[] = [
  { id: "basic", label: "Basic", color: "#d6d6d6" },
  { id: "medium", label: "Medium", color: "#edc84d" },
  { id: "important", label: "Important", color: "#e05b5b" },
  { id: "immediately", label: "Immediately", color: "#a67be3" },
  { id: "absolute", label: "Absolute", color: "#d6d6d6" },
];

export const PURPOSE_OPTIONS: readonly ModuleOption[] = [
  { id: "quote", label: "Quote", color: "#d5b77b", iconPath: "M3 4h10v8H3z M5 7h6 M5 9h4" },
  { id: "concept", label: "Concept", color: "#70b5a1", iconPath: "M8 2.5 13.5 8 8 13.5 2.5 8z M8 5v6 M5 8h6" },
  { id: "openQuestion", label: "Open question", color: "#78a9d4", iconPath: "M5.2 5.5a2.9 2.9 0 1 1 4.8 2.2c-1.1.9-2 1.2-2 2.8 M8 12.5v.1" },
  { id: "decision", label: "Decision", color: "#86b879", iconPath: "M3 8 6.4 11.2 13 4.8 M3 3.5h4 M9 12.5h4" },
  { id: "hypothesis", label: "Hypothesis", color: "#b79bd9", iconPath: "M5 2.8h6 M6 2.8v4.3l-3 5.6a1 1 0 0 0 .9 1.5h8.2a1 1 0 0 0 .9-1.5l-3-5.6V2.8 M4.4 10h7.2" },
  { id: "experiment", label: "Experiment", color: "#d38d69", iconPath: "M6 2.5h4 M7 2.5v4L3.5 12a1 1 0 0 0 .9 1.5h7.2a1 1 0 0 0 .9-1.5L9 6.5v-4 M5 10h6" },
  { id: "compare", label: "Compare", color: "#76aabd", iconPath: "M3 4.5h4v7H3z M9 4.5h4v7H9z M7 8h2" },
  { id: "timeline", label: "Timeline", color: "#cf91ae", iconPath: "M2.5 8h11 M4 5.5v5 M8 3.5v9 M12 6v4" },
];

export const MODULE_NOTE_WIDTH = 14;
export const MODULE_NOTE_HEIGHT = 4;

export type ModuleDataPatch = Partial<Pick<Note, "importance" | "purposes">>;
export type ModuleDataWriter = (noteId: string, patch: ModuleDataPatch) => void;
export type ModuleNoteValue = Pick<Note, "id" | "type" | "importance" | "purposes">;
export type ModuleNoteLookup = Readonly<Record<string, ModuleNoteValue | undefined>>;
export type ModuleEdge = Pick<Link, "from" | "to" | "kind">;

export function effectiveImportanceFor(
  noteId: string,
  notes: ModuleNoteLookup,
  edges: readonly ModuleEdge[],
): ImportanceLevel | null {
  const note = notes[noteId];
  if (!isAssignableNote(note)) return null;
  if (note.importance && isImportanceLevel(note.importance)) return note.importance;

  for (const module of linkedModules(noteId, "importance", notes, edges)) {
    if (module.importance && isImportanceLevel(module.importance)) return module.importance;
  }
  return null;
}

export function linkedImportanceSourceFor(
  noteId: string,
  notes: ModuleNoteLookup,
  edges: readonly ModuleEdge[],
): string | null {
  const note = notes[noteId];
  if (!isAssignableNote(note) || note.importance) return null;
  return linkedModules(noteId, "importance", notes, edges)
    .find((module) => module.importance && isImportanceLevel(module.importance))?.id ?? null;
}

export function effectivePurposesFor(
  noteId: string,
  notes: ModuleNoteLookup,
  edges: readonly ModuleEdge[],
): PurposeKind[] {
  const note = notes[noteId];
  if (!isAssignableNote(note)) return [];

  const result: PurposeKind[] = [];
  const add = (value: string) => {
    if (isPurposeKind(value) && !result.includes(value)) result.push(value);
  };
  for (const purpose of note.purposes ?? []) add(purpose);
  for (const module of linkedModules(noteId, "purpose", notes, edges)) {
    for (const purpose of module.purposes ?? []) add(purpose);
  }
  return result;
}

export function linkedPurposesFor(
  noteId: string,
  notes: ModuleNoteLookup,
  edges: readonly ModuleEdge[],
): PurposeKind[] {
  const result: PurposeKind[] = [];
  for (const module of linkedModules(noteId, "purpose", notes, edges)) {
    for (const purpose of module.purposes ?? []) {
      if (isPurposeKind(purpose) && !result.includes(purpose)) result.push(purpose);
    }
  }
  return result;
}

export function linkedImportanceSourcesFor(
  noteId: string,
  notes: ModuleNoteLookup,
  edges: readonly ModuleEdge[],
): string[] {
  return linkedModules(noteId, "importance", notes, edges)
    .filter((module) => Boolean(module.importance && isImportanceLevel(module.importance)))
    .map((module) => module.id);
}

export function importanceMenuLabel(note: Pick<Note, "importance"> | undefined): string {
  return note?.importance ? "Change Importance" : "Add Importance";
}

export function isImportanceLevel(value: string): value is ImportanceLevel {
  return IMPORTANCE_LEVELS.includes(value as ImportanceLevel);
}

export function isPurposeKind(value: string): value is PurposeKind {
  return PURPOSE_KINDS.includes(value as PurposeKind);
}

export function createImportanceCommand(
  note: Pick<Note, "id" | "name" | "importance">,
  next: ImportanceLevel | null,
  write: ModuleDataWriter,
): HistoryCommand | null {
  const previous = note.importance;
  if ((previous ?? null) === next) return null;

  return {
    label: next ? `Importance: ${next}` : "Remove Importance",
    target: note.name,
    do: () => write(note.id, { importance: next }),
    undo: () => write(note.id, { importance: previous }),
  };
}

export function createPurposeToggleCommand(
  note: Pick<Note, "id" | "name" | "purposes">,
  purpose: PurposeKind,
  write: ModuleDataWriter,
): HistoryCommand | null {
  const previous = note.purposes ? [...note.purposes] : note.purposes;
  const current = note.purposes ?? [];
  const adding = !current.includes(purpose);
  const next = adding ? [...current, purpose] : current.filter((item) => item !== purpose);
  if (sameValues(current, next) && note.purposes !== undefined) return null;

  const label = PURPOSE_OPTIONS.find((option) => option.id === purpose)?.label ?? purpose;
  return {
    label: `${adding ? "Add" : "Remove"} Purpose: ${label}`,
    target: note.name,
    do: () => write(note.id, { purposes: next }),
    undo: () => write(note.id, { purposes: previous }),
  };
}

export function createPurposeSelectionCommand(
  note: Pick<Note, "id" | "name" | "purposes">,
  purpose: PurposeKind,
  write: ModuleDataWriter,
): HistoryCommand | null {
  const previous = note.purposes ? [...note.purposes] : note.purposes;
  const next = [purpose];
  if (previous?.length === 1 && previous[0] === purpose) return null;

  const label = PURPOSE_OPTIONS.find((option) => option.id === purpose)?.label ?? purpose;
  return {
    label: `Purpose: ${label}`,
    target: note.name,
    do: () => write(note.id, { purposes: next }),
    undo: () => write(note.id, { purposes: previous }),
  };
}

function sameValues(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function isAssignableNote(note: ModuleNoteValue | undefined): note is ModuleNoteValue {
  return note?.type === "note" || note?.type === "pro" || note?.type === "con";
}

function linkedModules(
  noteId: string,
  type: "importance" | "purpose",
  notes: ModuleNoteLookup,
  edges: readonly ModuleEdge[],
): ModuleNoteValue[] {
  const found: ModuleNoteValue[] = [];
  const seen = new Set<string>();
  for (const edge of edges) {
    if (edge.kind !== "strong") continue;
    const otherId = edge.from === noteId ? edge.to : edge.to === noteId ? edge.from : null;
    if (!otherId || seen.has(otherId)) continue;
    const module = notes[otherId];
    if (module?.type !== type) continue;
    seen.add(otherId);
    found.push(module);
  }
  return found;
}
