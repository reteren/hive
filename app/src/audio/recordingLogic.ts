import type { HistoryCommand } from "../history/historyStack";
import { newId, R5_BASE_WIDTHS, type Note } from "../model/note";
import { uniqueName } from "../notes/naming";
import { copyAudioRecordings, type AudioRecording } from "./recordingData";

export type RecordingPhase = "idle" | "requesting" | "recording" | "saving" | "error";

export const RECORDING_DRAG_THRESHOLD = 6;

export interface RecordingPointerSample {
  pointerId: number;
  clientX: number;
  clientY: number;
  ctrlKey?: boolean;
}

export interface RecordingDragGesture {
  pointerId: number;
  startX: number;
  startY: number;
  active: boolean;
}

export type RecordingDropAction = "move" | "copy" | null;

export function beginRecordingDrag(event: RecordingPointerSample): RecordingDragGesture {
  return {
    pointerId: event.pointerId,
    startX: event.clientX,
    startY: event.clientY,
    active: false,
  };
}

export function moveRecordingDrag(
  gesture: RecordingDragGesture,
  event: RecordingPointerSample,
): RecordingDragGesture {
  if (event.pointerId !== gesture.pointerId || gesture.active) return gesture;
  const distance = Math.hypot(event.clientX - gesture.startX, event.clientY - gesture.startY);
  return distance >= RECORDING_DRAG_THRESHOLD ? { ...gesture, active: true } : gesture;
}

export function finishRecordingDrag(
  gesture: RecordingDragGesture,
  event: RecordingPointerSample,
  target: { overBoard: boolean; overNode: boolean },
): RecordingDropAction {
  if (event.pointerId !== gesture.pointerId) return null;
  const finalGesture = moveRecordingDrag(gesture, event);
  if (!finalGesture.active || !target.overBoard || target.overNode) return null;
  return event.ctrlKey ? "copy" : "move";
}

export type RecordingEvent =
  | { type: "request" }
  | { type: "started" }
  | { type: "stop" }
  | { type: "saved" }
  | { type: "failed" }
  | { type: "blur"; recordInBackground: boolean }
  | { type: "selection-change" };

/** Dictaphone lifecycle; selection changes intentionally leave capture untouched. */
export function transitionRecording(phase: RecordingPhase, event: RecordingEvent): RecordingPhase {
  switch (event.type) {
    case "request":
      return phase === "idle" || phase === "error" ? "requesting" : phase;
    case "started":
      return phase === "requesting" ? "recording" : phase;
    case "stop":
      return phase === "recording" ? "saving" : phase;
    case "saved":
      return phase === "saving" ? "idle" : phase;
    case "failed":
      return phase === "requesting" || phase === "recording" || phase === "saving" ? "error" : phase;
    case "blur":
      return phase === "recording" && !event.recordInBackground ? "saving" : phase;
    case "selection-change":
      return phase;
  }
}

export function nextRecordingName(recordings: readonly AudioRecording[]): string {
  const used = new Set(recordings.map(({ name }) => name.trim().toLocaleLowerCase()));
  let index = 1;
  while (used.has(`recording ${index}`)) index += 1;
  return `Recording ${index}`;
}

export function appendRecording(
  recordings: readonly AudioRecording[],
  recording: AudioRecording,
): AudioRecording[] {
  return [...copyAudioRecordings([...recordings]) ?? [], { ...recording, media: { ...recording.media } }];
}

export function renameRecording(
  recordings: readonly AudioRecording[],
  id: string,
  name: string,
): AudioRecording[] | null {
  const normalized = name.trim();
  if (!normalized || normalized.length > 500) return null;
  if (!recordings.some((recording) => recording.id === id)) return null;
  return recordings.map((recording) => recording.id === id
    ? { ...recording, name: normalized, media: { ...recording.media } }
    : { ...recording, media: { ...recording.media } });
}

export function deleteRecording(
  recordings: readonly AudioRecording[],
  id: string,
): { recordings: AudioRecording[]; deleted: AudioRecording } | null {
  const deleted = recordings.find((recording) => recording.id === id);
  if (!deleted) return null;
  return {
    recordings: recordings.filter((recording) => recording.id !== id)
      .map((recording) => ({ ...recording, media: { ...recording.media } })),
    deleted: { ...deleted, media: { ...deleted.media } },
  };
}

export function canDropAudioNodeOnDictaphone(source: Note | undefined, target: Note | undefined): boolean {
  return Boolean(source && target && source.id !== target.id && source.type === "audio" &&
    source.media?.kind === "audio" && !Array.isArray(source.recordings) &&
    target.type === "audio" && Array.isArray(target.recordings));
}

export function recordingFromAudioNode(source: Note | undefined, id = newId()): AudioRecording | null {
  if (!source || source.type !== "audio" || source.media?.kind !== "audio" || Array.isArray(source.recordings)) return null;
  return { id, name: source.name, media: { ...source.media } };
}

/** A single reversible command for moving or copying a standalone audio node into a dictaphone. */
export function dictaphoneDropCommand(
  source: Note,
  before: readonly AudioRecording[],
  recording: AudioRecording,
  copy: boolean,
  effects: {
    applyRecordings(recordings: AudioRecording[]): void;
    removeSource(): void;
    restoreSource(): void;
    selectDictaphone(): void;
    restoreSelection(): void;
  },
): HistoryCommand {
  const previous = copyAudioRecordings([...before]) ?? [];
  const next = appendRecording(previous, recording);
  return {
    label: copy ? "Copy audio into dictaphone" : "Move audio into dictaphone",
    target: source.name,
    do: () => {
      effects.applyRecordings(copyAudioRecordings(next) ?? []);
      if (!copy) effects.removeSource();
      effects.selectDictaphone();
    },
    undo: () => {
      if (!copy) effects.restoreSource();
      effects.applyRecordings(copyAudioRecordings(previous) ?? []);
      effects.restoreSelection();
    },
  };
}

/** A one-row Undo command for append, rename or delete operations. */
export function recordingListCommand(
  before: readonly AudioRecording[],
  after: readonly AudioRecording[],
  apply: (recordings: AudioRecording[]) => void,
  label: string,
  target: string,
): HistoryCommand {
  const previous = copyAudioRecordings([...before]) ?? [];
  const next = copyAudioRecordings([...after]) ?? [];
  return {
    label,
    target,
    do: () => apply(copyAudioRecordings(next) ?? []),
    undo: () => apply(copyAudioRecordings(previous) ?? []),
  };
}

export function droppedAudioNote(
  recording: AudioRecording,
  center: { x: number; y: number },
  existingNames: readonly string[],
  id = newId(),
): Note {
  const width = R5_BASE_WIDTHS.audio;
  return {
    id,
    type: "audio",
    name: uniqueName(recording.name, existingNames),
    text: "",
    x: center.x - width / 2,
    y: center.y - 8,
    width,
    height: null,
    createdAt: Date.now(),
    media: { ...recording.media },
  };
}

export function droppedAudioNoteCommand(
  note: Note,
  add: (note: Note) => void,
  remove: (id: string) => void,
): HistoryCommand {
  return {
    label: "Create audio node",
    target: note.name,
    do: () => add(note),
    undo: () => remove(note.id),
  };
}

/** One Undo entry for pulling a dictaphone recording onto the board. */
export function pulledOutRecordingCommand(
  note: Note,
  before: readonly AudioRecording[],
  after: readonly AudioRecording[],
  effects: {
    applyRecordings(recordings: AudioRecording[]): void;
    addNote(note: Note): void;
    removeNote(id: string): void;
    selectCreated(): void;
    restoreSelection(): void;
  },
): HistoryCommand {
  const previous = copyAudioRecordings([...before]) ?? [];
  const next = copyAudioRecordings([...after]) ?? [];
  return {
    label: "Move recording to board",
    target: note.name,
    do: () => {
      effects.addNote(note);
      effects.applyRecordings(copyAudioRecordings(next) ?? []);
      effects.selectCreated();
    },
    undo: () => {
      effects.removeNote(note.id);
      effects.applyRecordings(copyAudioRecordings(previous) ?? []);
      effects.restoreSelection();
    },
  };
}
