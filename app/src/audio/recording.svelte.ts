import { addNote, board, removeNote, updateNote } from "../model/board.svelte";
import { newId, R5_BASE_WIDTHS, type Note } from "../model/note";
import { record } from "../history/history.svelte";
import { captureSelectionSnapshot, clearSelection, restoreSelectionSnapshot, selectOnly } from "../selection/selection.svelte";
import { clearSelectedLink } from "../links/selection.svelte";
import { preferences } from "../settings/preferences.svelte";
import { importRecording, reportImportError } from "../attachments/service";
import { uniqueName } from "../notes/naming";
import { transitionRecording, type RecordingPhase } from "./recordingLogic";

export const audioRecording = $state({
  noteId: null as string | null,
  phase: "idle" as RecordingPhase,
  elapsedSeconds: 0,
  level: 0,
  error: "",
});

interface Capture {
  note: Note;
  index: number;
  previousSelection: ReturnType<typeof captureSelectionSnapshot>;
  canceled: boolean;
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

/** Place a temporary node immediately; the single history entry is recorded when its file is saved. */
export function beginAudioRecording(center: { x: number; y: number }): boolean {
  if (capture) {
    reportImportError("An audio recording is already in progress.");
    return false;
  }

  const width = R5_BASE_WIDTHS.audio;
  const note: Note = {
    id: newId(),
    type: "audio",
    name: uniqueName("Audio", Object.values(board.notes).map((item) => item.name)),
    text: "",
    x: center.x - width / 2,
    y: center.y - width / 2,
    width,
    height: null,
    createdAt: Date.now(),
  };
  const session: Capture = {
    note,
    index: board.order.length,
    previousSelection: captureSelectionSnapshot(),
    canceled: false,
    chunks: [],
  };

  capture = session;
  addNote(note, session.index);
  clearSelection();
  clearSelectedLink();
  selectOnly(note.id);
  audioRecording.noteId = note.id;
  audioRecording.phase = transitionRecording("idle", { type: "request" });
  audioRecording.elapsedSeconds = 0;
  audioRecording.level = 0;
  audioRecording.error = "";
  void requestMicrophone(session);
  return true;
}

async function requestMicrophone(session: Capture): Promise<void> {
  try {
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") {
      throw new Error("No microphone");
    }
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    if (capture !== session || session.canceled) {
      stopTracks(stream);
      return;
    }
    session.stream = stream;
    const mime = "audio/webm;codecs=opus";
    if (!MediaRecorder.isTypeSupported(mime)) throw new Error("Audio recording is not supported in this webview.");
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
      ? "No microphone"
      : name === "NotAllowedError" || name === "SecurityError"
        ? "Microphone blocked"
        : error instanceof Error ? error.message : String(error);
    failRecording(session, message);
  }
}

export function stopAudioRecording(): void {
  const session = capture;
  if (!session || audioRecording.phase !== "recording") return;
  audioRecording.phase = transitionRecording(audioRecording.phase, { type: "stop" });
  requestStop(session);
}

/** Cancel the in-progress creation without leaving an undo row or an empty audio node. */
export function cancelAudioRecording(): void {
  const session = capture;
  if (!session) return;
  session.canceled = true;
  audioRecording.phase = transitionRecording(audioRecording.phase, { type: "cancel" });
  cleanup(session);
  capture = null;
  removeNote(session.note.id);
  restoreSelectionSnapshot(session.previousSelection);
  audioRecording.noteId = null;
  audioRecording.elapsedSeconds = 0;
  audioRecording.level = 0;
  if (session.recorder && session.recorder.state !== "inactive") session.recorder.stop();
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
  if (capture !== session || session.canceled) return;
  try {
    const blob = new Blob(session.chunks, { type: mime });
    if (blob.size === 0) throw new Error("No audio was recorded.");
    const bytes = new Uint8Array(await blob.arrayBuffer());
    const result = await importRecording(bytes, mime, `${session.note.name}.webm`);
    if (capture !== session || session.canceled) return;
    if (!result.ok) throw new Error(result.error);
    if (result.media.kind !== "audio") throw new Error("The recorded file was not recognized as audio.");

    updateNote(session.note.id, { media: result.media });
    const savedNote = board.notes[session.note.id];
    if (!savedNote) throw new Error("The recording node was removed before it could be saved.");
    record({
      label: "Record audio",
      target: savedNote.name,
      do: () => {
        addNote(savedNote, session.index);
        clearSelection();
        selectOnly(savedNote.id);
      },
      undo: () => {
        removeNote(savedNote.id);
        restoreSelectionSnapshot(session.previousSelection);
      },
    });
    audioRecording.phase = transitionRecording(audioRecording.phase, { type: "saved" });
    audioRecording.level = 0;
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
  audioRecording.error = message;
  audioRecording.level = 0;
  cleanup(session);
  capture = null;
  removeNote(session.note.id);
  restoreSelectionSnapshot(session.previousSelection);
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
