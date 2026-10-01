import { parseMediaRef } from "../formats/formatLogic";
import type { Note } from "../model/note";

export type AudioRecording = NonNullable<Note["recordings"]>[number];

export function copyAudioRecordings(
  recordings: Note["recordings"],
): Note["recordings"] {
  return recordings?.map((recording) => ({
    id: recording.id,
    name: recording.name,
    media: { ...recording.media },
  }));
}

export function parseAudioRecordings(value: unknown): AudioRecording[] | null {
  if (!Array.isArray(value)) return null;
  const ids = new Set<string>();
  const recordings: AudioRecording[] = [];

  for (const candidate of value) {
    if (!isRecord(candidate) || typeof candidate.id !== "string" || !candidate.id.trim() || candidate.id.length > 200 ||
      typeof candidate.name !== "string" || !candidate.name.trim() || candidate.name.length > 500 || ids.has(candidate.id)) {
      return null;
    }
    const media = parseMediaRef(candidate.media);
    if (!media || media.kind !== "audio") return null;
    ids.add(candidate.id);
    recordings.push({ id: candidate.id, name: candidate.name, media });
  }

  return recordings;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
