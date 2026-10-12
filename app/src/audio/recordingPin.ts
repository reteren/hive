import type { RecordingPhase } from "./recordingLogic";

const PINNED_PHASES: ReadonlySet<RecordingPhase> = new Set(["requesting", "recording", "saving"]);

/** Keeps one dictaphone mounted throughout microphone request, recording, and save. */
export function createRecordingPinController(
  pinNote: (noteId: string, reason: string) => () => void,
): {
  update(noteId: string | null, phase: RecordingPhase): void;
  release(): void;
} {
  let pinnedNoteId: string | null = null;
  let releasePin: (() => void) | null = null;

  const release = (): void => {
    releasePin?.();
    releasePin = null;
    pinnedNoteId = null;
  };

  return {
    update(noteId, phase) {
      if (!noteId || !PINNED_PHASES.has(phase)) {
        release();
        return;
      }
      if (pinnedNoteId === noteId) return;
      release();
      pinnedNoteId = noteId;
      releasePin = pinNote(noteId, "dictaphone recording");
    },
    release,
  };
}
