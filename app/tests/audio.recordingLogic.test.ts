import { describe, expect, it } from "vitest";
import { HistoryStack } from "../src/history/historyStack";
import type { MediaRef } from "../src/attachments/types";
import {
  appendRecording,
  deleteRecording,
  droppedAudioNote,
  droppedAudioNoteCommand,
  nextRecordingName,
  parseRecordingDrag,
  recordingListCommand,
  renameRecording,
  serializeRecordingDrag,
  transitionRecording,
} from "../src/audio/recordingLogic";
import type { AudioRecording } from "../src/audio/recordingData";

function recording(id: string, name: string): AudioRecording {
  const media: MediaRef = {
    file: `${id.repeat(64).slice(0, 64)}.webm`,
    mime: "audio/webm",
    size: 512,
    kind: "audio",
    name: `${name}.webm`,
    duration: 1.5,
  };
  return { id, name, media };
}

describe("dictaphone state and list operations", () => {
  it("can record several sessions while selection changes leave capture running", () => {
    let phase = transitionRecording("idle", { type: "request" });
    phase = transitionRecording(phase, { type: "started" });
    expect(transitionRecording(phase, { type: "selection-change" })).toBe("recording");
    phase = transitionRecording(phase, { type: "stop" });
    phase = transitionRecording(phase, { type: "saved" });
    expect(phase).toBe("idle");
    expect(transitionRecording(phase, { type: "request" })).toBe("requesting");
    expect(transitionRecording("recording", { type: "blur", recordInBackground: false })).toBe("saving");
    expect(transitionRecording("recording", { type: "blur", recordInBackground: true })).toBe("recording");
  });

  it("appends sequentially named recordings and supports rename, delete, Undo and Redo", () => {
    let list = [recording("a", "Recording 1")];
    const second = recording("b", nextRecordingName(list));
    list = appendRecording(list, second);
    const third = recording("c", nextRecordingName(list));
    list = appendRecording(list, third);
    expect(list.map((item) => item.name)).toEqual(["Recording 1", "Recording 2", "Recording 3"]);

    const history = new HistoryStack();
    const renamed = renameRecording(list, "b", "Intro take");
    expect(renamed?.[1]?.name).toBe("Intro take");
    expect(renameRecording(list, "b", "  ")).toBeNull();
    history.execute(recordingListCommand(list, renamed!, (next) => { list = next; }, "Rename recording", "Intro take"));

    const deleted = deleteRecording(list, "a");
    expect(deleted?.deleted.name).toBe("Recording 1");
    history.execute(recordingListCommand(list, deleted!.recordings, (next) => { list = next; }, "Delete recording", "Recording 1"));
    expect(history.entries).toHaveLength(2);
    expect(list.map((item) => item.id)).toEqual(["b", "c"]);
    history.undo();
    expect(list.map((item) => item.id)).toEqual(["a", "b", "c"]);
    history.undo();
    expect(list[1]?.name).toBe("Recording 2");
    history.redo();
    expect(list[1]?.name).toBe("Intro take");
  });

  it("drags a recording into a standalone audio node with one undoable add", () => {
    const source = recording("d", "Field notes");
    const payload = parseRecordingDrag(serializeRecordingDrag(source));
    expect(payload).toEqual(source);
    const note = droppedAudioNote(payload!, { x: 50, y: 30 }, ["Field notes"], "drop-audio");
    expect(note).toMatchObject({
      id: "drop-audio",
      type: "audio",
      name: "Field notes 2",
      x: 33,
      y: 22,
      media: source.media,
    });
    expect(parseRecordingDrag("not json")).toBeNull();

    const notes = new Map<string, typeof note>();
    const history = new HistoryStack();
    history.execute(droppedAudioNoteCommand(note, (added) => notes.set(added.id, added), (id) => notes.delete(id)));
    expect(notes.get(note.id)).toEqual(note);
    expect(history.entries).toHaveLength(1);
    history.undo();
    expect(notes.has(note.id)).toBe(false);
    history.redo();
    expect(notes.get(note.id)).toEqual(note);
  });
});
