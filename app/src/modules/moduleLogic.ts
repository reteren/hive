import type { HistoryCommand } from "../history/historyStack";
import type { CustomMark } from "../model/nodeData";
import {
  IMPORTANCE_LEVELS,
  MOOD_KINDS,
  PURPOSE_KINDS,
  type ImportanceLevel,
  type MoodKind,
  type Note,
  type PurposeKind,
} from "../model/note";
import type { Link } from "../model/link";
import { t } from "../i18n/i18n.svelte";

export interface ModuleOption {
  id: string;
  label: string;
  color: string;
  iconPath?: string;
}

export const IMPORTANCE_OPTIONS: readonly ModuleOption[] = [
  { id: "basic", get label() { return t("Basic"); }, color: "#d6d6d6" },
  { id: "medium", get label() { return t("Medium"); }, color: "#edc84d" },
  { id: "important", get label() { return t("Important"); }, color: "#e05b5b" },
  { id: "immediately", get label() { return t("Immediately"); }, color: "#a67be3" },
  { id: "absolute", get label() { return t("Absolute"); }, color: "#d6d6d6" },
];

export const PURPOSE_OPTIONS: readonly ModuleOption[] = [
  { id: "quote", get label() { return t("Quote"); }, color: "#d5b77b", iconPath: "M3 4h10v8H3z M5 7h6 M5 9h4" },
  { id: "concept", get label() { return t("Concept"); }, color: "#70b5a1", iconPath: "M8 2.5 13.5 8 8 13.5 2.5 8z M8 5v6 M5 8h6" },
  { id: "openQuestion", get label() { return t("Open question"); }, color: "#78a9d4", iconPath: "M5.2 5.5a2.9 2.9 0 1 1 4.8 2.2c-1.1.9-2 1.2-2 2.8 M8 12.5v.1" },
  { id: "decision", get label() { return t("Decision"); }, color: "#86b879", iconPath: "M3 8 6.4 11.2 13 4.8 M3 3.5h4 M9 12.5h4" },
  { id: "hypothesis", get label() { return t("Hypothesis"); }, color: "#b79bd9", iconPath: "M5 2.8h6 M6 2.8v4.3l-3 5.6a1 1 0 0 0 .9 1.5h8.2a1 1 0 0 0 .9-1.5l-3-5.6V2.8 M4.4 10h7.2" },
  { id: "experiment", get label() { return t("Experiment"); }, color: "#d38d69", iconPath: "M6 2.5h4 M7 2.5v4L3.5 12a1 1 0 0 0 .9 1.5h7.2a1 1 0 0 0 .9-1.5L9 6.5v-4 M5 10h6" },
  { id: "compare", get label() { return t("Compare"); }, color: "#76aabd", iconPath: "M3 4.5h4v7H3z M9 4.5h4v7H9z M7 8h2" },
  { id: "timeline", get label() { return t("Timeline"); }, color: "#cf91ae", iconPath: "M2.5 8h11 M4 5.5v5 M8 3.5v9 M12 6v4" },
];

/** Moods use color alone; the board deliberately uses no emoji or mood pictograms. */
export const MOOD_OPTIONS: readonly ModuleOption[] = [
  { id: "anger", get label() { return t("Anger"); }, color: "#f06b68" },
  { id: "happiness", get label() { return t("Happiness"); }, color: "#f1c85b" },
  { id: "sadness", get label() { return t("Sadness"); }, color: "#79a9df" },
  { id: "disgust", get label() { return t("Disgust"); }, color: "#a5a84e" },
  { id: "fear", get label() { return t("Fear"); }, color: "#9c78c7" },
  { id: "surprise", get label() { return t("Surprise"); }, color: "#65c6c8" },
  { id: "joy", get label() { return t("Joy"); }, color: "#f0aa48" },
  { id: "love", get label() { return t("Love"); }, color: "#e780a8" },
  { id: "excitement", get label() { return t("Excitement"); }, color: "#ed8951" },
  { id: "gratitude", get label() { return t("Gratitude"); }, color: "#7ec5a0" },
  { id: "pride", get label() { return t("Pride"); }, color: "#c5a0e5" },
  { id: "envy", get label() { return t("Envy"); }, color: "#7fae62" },
  { id: "guilt", get label() { return t("Guilt"); }, color: "#c28362" },
  { id: "shame", get label() { return t("Shame"); }, color: "#bd7894" },
  { id: "jealousy", get label() { return t("Jealousy"); }, color: "#688e58" },
  { id: "disappointment", get label() { return t("Disappointment"); }, color: "#8494b2" },
  { id: "confusion", get label() { return t("Confusion"); }, color: "#b1a1d5" },
  { id: "curiosity", get label() { return t("Curiosity"); }, color: "#71b9ae" },
  { id: "boredom", get label() { return t("Boredom"); }, color: "#92979e" },
  { id: "relief", get label() { return t("Relief"); }, color: "#8dc9bd" },
];

export const MODULE_NOTE_WIDTH = 14;
export const MODULE_NOTE_HEIGHT = 4;

export type ModuleArrayKind = "purpose" | "mood";
export type ExternalModuleKind = "importance" | ModuleArrayKind | "markas";
export type ModuleRowKind = ExternalModuleKind;
export type ModuleDataPatch = Partial<Pick<Note, "importance" | "purposes" | "moods" | "customMarks" | "customMarkFrame">>;
export type ModuleDataWriter = (noteId: string, patch: ModuleDataPatch) => void;
export type ModuleNoteValue = Pick<Note, "id" | "type" | "importance" | "purposes" | "moods" | "customMarks" | "customMarkFrame">;
export type ModuleNoteLookup = Readonly<Record<string, ModuleNoteValue | undefined>>;
export type ModuleEdge = Pick<Link, "from" | "to" | "kind">;

export function effectiveImportanceFor(
  noteId: string,
  notes: ModuleNoteLookup,
  edges: readonly ModuleEdge[],
): ImportanceLevel | null {
  const note = notes[noteId];
  if (note?.type !== "message" && !isAssignableNote(note)) return null;
  for (const module of linkedModules(noteId, "importance", notes, edges)) {
    if (module.importance && isImportanceLevel(module.importance)) return module.importance;
  }
  if (note.importance && isImportanceLevel(note.importance)) return note.importance;
  return null;
}

export function linkedImportanceSourceFor(
  noteId: string,
  notes: ModuleNoteLookup,
  edges: readonly ModuleEdge[],
): string | null {
  const note = notes[noteId];
  if (note?.type !== "message" && !isAssignableNote(note)) return null;
  return linkedModules(noteId, "importance", notes, edges)
    .find((module) => module.importance && isImportanceLevel(module.importance))?.id ?? null;
}

export function effectivePurposesFor(
  noteId: string,
  notes: ModuleNoteLookup,
  edges: readonly ModuleEdge[],
): PurposeKind[] {
  return effectiveArrayValues(noteId, "purpose", "purposes", notes, edges, isPurposeKind);
}

export function effectiveMoodsFor(
  noteId: string,
  notes: ModuleNoteLookup,
  edges: readonly ModuleEdge[],
): MoodKind[] {
  return effectiveArrayValues(noteId, "mood", "moods", notes, edges, isMoodKind);
}

export function linkedPurposesFor(
  noteId: string,
  notes: ModuleNoteLookup,
  edges: readonly ModuleEdge[],
): PurposeKind[] {
  return linkedArrayValues(noteId, "purpose", "purposes", notes, edges, isPurposeKind);
}

export function linkedMoodsFor(
  noteId: string,
  notes: ModuleNoteLookup,
  edges: readonly ModuleEdge[],
): MoodKind[] {
  return linkedArrayValues(noteId, "mood", "moods", notes, edges, isMoodKind);
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

export function importanceMenuLabel(
  note: Pick<Note, "importance"> | undefined,
  hasLinkedSource = false,
): string {
  return note?.importance || hasLinkedSource ? t("Change Importance") : t("Add Importance");
}

export function moduleRowsFor(
  importance: ImportanceLevel | null,
  purposes: readonly PurposeKind[],
  moods: readonly MoodKind[],
  customMarks: readonly CustomMark[] = [],
): ModuleRowKind[] {
  const rows: ModuleRowKind[] = [];
  if (importance) rows.push("importance");
  if (purposes.length > 0) rows.push("purpose");
  if (moods.length > 0) rows.push("mood");
  if (customMarks.length > 0) rows.push("markas");
  return rows;
}

export function isImportanceLevel(value: string): value is ImportanceLevel {
  return IMPORTANCE_LEVELS.includes(value as ImportanceLevel);
}

export function isPurposeKind(value: string): value is PurposeKind {
  return PURPOSE_KINDS.includes(value as PurposeKind);
}

export function isMoodKind(value: string): value is MoodKind {
  return MOOD_KINDS.includes(value as MoodKind);
}

export function createImportanceCommand(
  note: Pick<Note, "id" | "name" | "importance">,
  next: ImportanceLevel | null,
  write: ModuleDataWriter,
): HistoryCommand | null {
  const previous = note.importance;
  if ((previous ?? null) === next) return null;

  return {
    label: next ? t("Importance: {next}", { next: next }) : t("Remove Importance"),
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
  const label = PURPOSE_OPTIONS.find((option) => option.id === purpose)?.label ?? purpose;
  return createArrayToggleCommand(note, "purposes", purpose, label, write);
}

export function createMoodToggleCommand(
  note: Pick<Note, "id" | "name" | "moods">,
  mood: MoodKind,
  write: ModuleDataWriter,
): HistoryCommand | null {
  const label = MOOD_OPTIONS.find((option) => option.id === mood)?.label ?? mood;
  return createArrayToggleCommand(note, "moods", mood, label, write);
}

function createArrayToggleCommand<T extends PurposeKind | MoodKind>(
  note: Pick<Note, "id" | "name"> & Partial<Pick<Note, "purposes" | "moods">>,
  field: "purposes" | "moods",
  value: T,
  label: string,
  write: ModuleDataWriter,
): HistoryCommand | null {
  const previous = note[field] ? [...note[field]!] : note[field];
  const current = note[field] ?? [];
  const adding = !current.includes(value as never);
  const next = adding ? [...current, value] : current.filter((item) => item !== value);
  if (sameValues(current, next) && note[field] !== undefined) return null;

  return {
    label: `${adding ? t("Add") : t("Remove")} ${field === "purposes" ? t("Purpose") : t("Mood")}: ${label}`,
    target: note.name,
    do: () => write(note.id, { [field]: next }),
    undo: () => write(note.id, { [field]: previous }),
  };
}

function effectiveArrayValues<T extends PurposeKind | MoodKind>(
  noteId: string,
  moduleType: ModuleArrayKind,
  field: "purposes" | "moods",
  notes: ModuleNoteLookup,
  edges: readonly ModuleEdge[],
  isValue: (value: string) => value is T,
): T[] {
  const note = notes[noteId];
  if (!isAssignableNote(note)) return [];
  const result = validUniqueValues(note[field], isValue);
  for (const module of linkedModules(noteId, moduleType, notes, edges)) {
    for (const value of validUniqueValues(module[field], isValue)) {
      if (!result.includes(value)) result.push(value);
    }
  }
  return result;
}

function linkedArrayValues<T extends PurposeKind | MoodKind>(
  noteId: string,
  moduleType: ModuleArrayKind,
  field: "purposes" | "moods",
  notes: ModuleNoteLookup,
  edges: readonly ModuleEdge[],
  isValue: (value: string) => value is T,
): T[] {
  const result: T[] = [];
  for (const module of linkedModules(noteId, moduleType, notes, edges)) {
    for (const value of validUniqueValues(module[field], isValue)) {
      if (!result.includes(value)) result.push(value);
    }
  }
  return result;
}

function validUniqueValues<T extends PurposeKind | MoodKind>(
  values: readonly string[] | undefined,
  isValue: (value: string) => value is T,
): T[] {
  const result: T[] = [];
  for (const value of values ?? []) {
    if (isValue(value) && !result.includes(value)) result.push(value);
  }
  return result;
}

function sameValues(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function isAssignableNote(note: ModuleNoteValue | undefined): note is ModuleNoteValue {
  return note?.type === "note" || note?.type === "pro" || note?.type === "con";
}

function linkedModules(
  noteId: string,
  type: "importance" | ModuleArrayKind,
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
