import { screenToWorld, type Point } from "../board/cameraMath";
import { camera, viewport } from "../board/camera.svelte";
import { addNote, board, removeNote, updateNote } from "../model/board.svelte";
import { newId, R5_BASE_WIDTHS, type Note } from "../model/note";
import { execute } from "../history/history.svelte";
import { captureSelectionSnapshot, clearSelection, restoreSelectionSnapshot, selectOnly } from "../selection/selection.svelte";
import { clearSelectedLink } from "../links/selection.svelte";
import { preferences } from "../settings/preferences.svelte";
import { importRecording, reportImportError } from "../attachments/service";
import { uniqueName } from "../notes/naming";
import { copyAudioRecordings } from "./recordingData";
import {
  appendRecording,
  deleteRecording,
  droppedAudioNote,
  droppedAudioNoteCommand,
  nextRecordingName,
  parseRecordingDrag,
  recordingListCommand,
  renameRecording,
  transitionRecording,
  type RecordingPhase,
} from "./recordingLogic";

export const AUDIO_RECORDING_DRAG_TYPE = "application/x-hive-audio-recording";

export const audioRecording = $state({
  noteId: null as string | null,
  phase: "idle" as RecordingPhase,
  elapsedSeconds: 0,
  level: 0,
  error: "",
});

interface Capture {
  noteId: string;
  noteName: string;
  stream?: MediaStream;
  recorder?: MediaRecorder;
  chunks: BlobPart[];
  startedAt?: number;
  clockTimer?: number;
  meterTimer?: number;
  audioContext?: AudioContext;
  analyser?: AnalyserNode;
}

let capture: Capture | null = null;
let dropListenerCount = 0;

export function createDictaphoneNote(center: Point): string {
  const width = R5_BASE_WIDTHS.audio;
  const note: Note = {
    id: newId(),
    type: "audio",
    name: uniqueName("Recorder", Object.values(board.notes).map((item) => item.name)),
    text: "",
    x: center.x - width / 2,
    y: center.y - 8,
    width,
    height: null,
    createdAt: Date.now(),
    recordings: [],
  };
  const index = board.order.length;
  const previousSelection = captureSelectionSnapshot();
  execute({
    label: "Create dictaphone",
    target: note.name,
    do: () => {
      addNote(note, index);
      clearSelection();
      clearSelectedLink();
      selectOnly(note.id);
    },
    undo: () => {
      removeNote(note.id);
      restoreSelectionSnapshot(previousSelection);
    },
  });
  return note.id;
}

/** Called only by the visible record button; creating a dictaphone never requests a microphone. */
export function beginAudioRecording(noteId: string): boolean {
  if (capture) {
    reportImportError("An audio recording is already in progress.");
    return false;
  }
  const note = board.notes[noteId];
  if (!note || note.type !== "audio" || !Array.isArray(note.recordings)) return false;

  const session: Capture = { noteId, noteName: note.name, chunks: [] };
  capture = session;
  audioRecording.noteId = noteId;
  audioRecording.phase = transitionRecording(audioRecording.phase, { type: "request" });
  audioRecording.elapsedSeconds = 0;
  audioRecording.level = 0;
  audioRecording.error = "";
  void requestMicrophone(session);
  return true;
}

async function requestMicrophone(session: Capture): Promise<void> {
  try {
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") {
      throw new Error("This webview does not support audio recording.");
    }
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    if (capture !== session) {
      stopTracks(stream);
      return;
    }
    session.stream = stream;
    const mime = "audio/webm;codecs=opus";
    if (!MediaRecorder.isTypeSupported(mime)) throw new Error("This webview does not support WebM audio recording.");
    const recorder = new MediaRecorder(stream, { mimeType: mime });
    session.recorder = recorder;
    recorder.addEventListener("dataavailable", (event) => {
      if (event.data.size > 0) session.chunks.push(event.data);
    });
    recorder.addEventListener("stop", () => void finishRecording(session, mime));
    recorder.addEventListener("error", () => failRecording(session, "The audio recording failed."));
    recorder.start(250);
    session.startedAt = performance.now();
    audioRecording.phase = transitionRecording(audioRecording.phase, { type: "started" });
    window.addEventListener("blur", handleWindowBlur);
    startMeters(session);
  } catch (error) {
    const name = error instanceof DOMException ? error.name : "";
    const message = name === "NotFoundError" || name === "DevicesNotFoundError"
      ? "No microphone was found."
      : name === "NotAllowedError" || name === "SecurityError"
        ? "Microphone access was blocked."
        : error instanceof Error ? error.message : String(error);
    failRecording(session, message);
  }
}

export function stopAudioRecording(noteId?: string): void {
  const session = capture;
  if (!session || noteId && session.noteId !== noteId || audioRecording.phase !== "recording") return;
  audioRecording.phase = transitionRecording(audioRecording.phase, { type: "stop" });
  requestStop(session);
}

export function renameAudioRecording(noteId: string, recordingId: string, name: string): boolean {
  const note = board.notes[noteId];
  if (!note || note.type !== "audio" || !note.recordings) return false;
  const before = copyAudioRecordings(note.recordings) ?? [];
  const after = renameRecording(before, recordingId, name);
  if (!after) return false;
  const previousName = before.find((recording) => recording.id === recordingId)?.name;
  const nextName = after.find((recording) => recording.id === recordingId)?.name;
  if (previousName === nextName) return false;
  execute(recordingListCommand(before, after, (recordings) => {
    updateNote(noteId, { recordings: copyAudioRecordings(recordings) ?? [] });
  }, "Rename recording", nextName ?? "Recording"));
  return true;
}

export function deleteAudioRecording(noteId: string, recordingId: string): boolean {
  const note = board.notes[noteId];
  if (!note || note.type !== "audio" || !note.recordings) return false;
  const before = copyAudioRecordings(note.recordings) ?? [];
  const deleted = deleteRecording(before, recordingId);
  if (!deleted) return false;
  execute(recordingListCommand(before, deleted.recordings, (recordings) => {
    updateNote(noteId, { recordings: copyAudioRecordings(recordings) ?? [] });
  }, "Delete recording", deleted.deleted.name));
  return true;
}

function handleWindowBlur(): void {
  const session = capture;
  if (!session || audioRecording.phase !== "recording") return;
  audioRecording.phase = transitionRecording(audioRecording.phase, {
    type: "blur",
    recordInBackground: preferences.recordInBackground,
  });
  if (audioRecording.phase === "saving") requestStop(session);
}

function requestStop(session: Capture): void {
  if (session.recorder && session.recorder.state !== "inactive") session.recorder.stop();
  else void finishRecording(session, "audio/webm;codecs=opus");
}

async function finishRecording(session: Capture, mime: string): Promise<void> {
  if (capture !== session) return;
  try {
    // MediaRecorder webm carries no duration header (the player reads Infinity), so keep the measured length.
    const recordedSeconds = Math.max(0, (performance.now() - (session.startedAt ?? performance.now())) / 1000);
    const blob = new Blob(session.chunks, { type: mime });
    if (blob.size === 0) throw new Error("No audio was recorded.");
    const bytes = new Uint8Array(await blob.arrayBuffer());
    const result = await importRecording(bytes, mime, `${session.noteName}.webm`);
    if (capture !== session) return;
    if (!result.ok) throw new Error(result.error);
    if (result.media.kind !== "audio") throw new Error("The recorded file was not recognized as audio.");

    const note = board.notes[session.noteId];
    if (!note || note.type !== "audio" || !Array.isArray(note.recordings)) {
      throw new Error("The dictaphone was removed before this recording could be saved.");
    }
    const before = copyAudioRecordings(note.recordings) ?? [];
    const recording = {
      id: newId(),
      name: nextRecordingName(before),
      media: Number.isFinite(result.media.duration) && (result.media.duration ?? 0) > 0
        ? result.media
        : { ...result.media, duration: recordedSeconds },
    };
    const after = appendRecording(before, recording);
    execute(recordingListCommand(before, after, (recordings) => {
      updateNote(session.noteId, { recordings: copyAudioRecordings(recordings) ?? [] });
    }, "Record audio", recording.name));
    audioRecording.phase = transitionRecording(audioRecording.phase, { type: "saved" });
    audioRecording.noteId = null;
    audioRecording.level = 0;
    audioRecording.elapsedSeconds = 0;
  } catch (error) {
    failRecording(session, error instanceof Error ? error.message : String(error));
  } finally {
    if (capture === session) {
      cleanup(session);
      capture = null;
    }
  }
}

function failRecording(session: Capture, message: string): void {
  if (capture !== session) return;
  audioRecording.phase = transitionRecording(audioRecording.phase, { type: "failed" });
  audioRecording.noteId = session.noteId;
  audioRecording.error = message;
  audioRecording.level = 0;
  audioRecording.elapsedSeconds = 0;
  cleanup(session);
  capture = null;
  reportImportError(message);
}

function startMeters(session: Capture): void {
  session.clockTimer = window.setInterval(() => {
    if (session.startedAt !== undefined && capture === session) {
      audioRecording.elapsedSeconds = Math.max(0, Math.floor((performance.now() - session.startedAt) / 1000));
    }
  }, 100);

  try {
    const context = new AudioContext();
    const analyser = context.createAnalyser();
    analyser.fftSize = 256;
    context.createMediaStreamSource(session.stream!).connect(analyser);
    session.audioContext = context;
    session.analyser = analyser;
    const samples = new Uint8Array(analyser.fftSize);
    session.meterTimer = window.setInterval(() => {
      if (capture !== session || !session.analyser) return;
      session.analyser.getByteTimeDomainData(samples);
      let sum = 0;
      for (const sample of samples) {
        const amplitude = (sample - 128) / 128;
        sum += amplitude * amplitude;
      }
      audioRecording.level = Math.min(1, Math.sqrt(sum / samples.length) * 3.2);
    }, 80);
  } catch {
    audioRecording.level = 0;
  }
}

function cleanup(session: Capture): void {
  window.removeEventListener("blur", handleWindowBlur);
  if (session.clockTimer !== undefined) window.clearInterval(session.clockTimer);
  if (session.meterTimer !== undefined) window.clearInterval(session.meterTimer);
  session.audioContext?.close().catch(() => undefined);
  if (session.stream) stopTracks(session.stream);
}

function stopTracks(stream: MediaStream): void {
  for (const track of stream.getTracks()) track.stop();
}

/** Install one shared board drop listener for all mounted dictaphone nodes. */
export function registerAudioRecordingDropHandler(): () => void {
  dropListenerCount += 1;
  if (dropListenerCount === 1) {
    document.addEventListener("dragover", handleRecordingDragOver, true);
    document.addEventListener("drop", handleRecordingDrop, true);
  }
  return () => {
    dropListenerCount = Math.max(0, dropListenerCount - 1);
    if (dropListenerCount === 0) {
      document.removeEventListener("dragover", handleRecordingDragOver, true);
      document.removeEventListener("drop", handleRecordingDrop, true);
    }
  };
}

function hasRecordingDrag(event: DragEvent): boolean {
  return Array.from(event.dataTransfer?.types ?? []).includes(AUDIO_RECORDING_DRAG_TYPE);
}

function isBoardEvent(event: DragEvent): boolean {
  return event.target instanceof Element && event.target.closest(".board") !== null;
}

function handleRecordingDragOver(event: DragEvent): void {
  if (!hasRecordingDrag(event) || !isBoardEvent(event)) return;
  event.preventDefault();
  if (event.dataTransfer) event.dataTransfer.dropEffect = "copy";
}

function handleRecordingDrop(event: DragEvent): void {
  if (!hasRecordingDrag(event) || !isBoardEvent(event) || !event.dataTransfer) return;
  const recording = parseRecordingDrag(event.dataTransfer.getData(AUDIO_RECORDING_DRAG_TYPE));
  if (!recording) return;
  const boardElement = document.querySelector<HTMLElement>(".board");
  if (!boardElement) return;
  event.preventDefault();
  event.stopPropagation();
  const bounds = boardElement.getBoundingClientRect();
  const center = screenToWorld(camera, viewport, {
    x: event.clientX - bounds.left,
    y: event.clientY - bounds.top,
  });
  const note = droppedAudioNote(recording, center, Object.values(board.notes).map((item) => item.name));
  const index = board.order.length;
  const previousSelection = captureSelectionSnapshot();
  execute(droppedAudioNoteCommand(note, (created) => {
      addNote(created, index);
      clearSelection();
      clearSelectedLink();
      selectOnly(created.id);
    }, (id) => {
      removeNote(id);
      restoreSelectionSnapshot(previousSelection);
    }));
}
