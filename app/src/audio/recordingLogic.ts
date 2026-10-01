import type { HistoryCommand } from "../history/historyStack";
import { newId, R5_BASE_WIDTHS, type Note } from "../model/note";
import { uniqueName } from "../notes/naming";
import { copyAudioRecordings, parseAudioRecordings, type AudioRecording } from "./recordingData";

export type RecordingPhase = "idle" | "requesting" | "recording" | "saving" | "error";

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

export function serializeRecordingDrag(recording: AudioRecording): string {
  return JSON.stringify({
    id: recording.id,
    name: recording.name,
    media: { ...recording.media },
  });
}

export function parseRecordingDrag(value: string): AudioRecording | null {
  try {
    return parseAudioRecordings([JSON.parse(value)])?.[0] ?? null;
  } catch {
    return null;
  }
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
