import { describe, expect, it } from "vitest";
import { HistoryStack } from "../src/history/historyStack";
import type { MediaRef } from "../src/attachments/types";
import {
  appendRecording,
  beginRecordingDrag,
  deleteRecording,
  droppedAudioNote,
  droppedAudioNoteCommand,
  finishRecordingDrag,
  moveRecordingDrag,
  nextRecordingName,
  pulledOutRecordingCommand,
  recordingListCommand,
  renameRecording,
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

  it("starts a pointer drag past the threshold and only accepts empty board drops", () => {
    const down = { pointerId: 4, clientX: 10, clientY: 20 };
    let gesture = beginRecordingDrag(down);
    gesture = moveRecordingDrag(gesture, { ...down, clientX: 13, clientY: 20 });
    expect(gesture.active).toBe(false);
    gesture = moveRecordingDrag(gesture, { ...down, clientX: 16, clientY: 20 });
    expect(gesture.active).toBe(true);

    const up = { ...down, clientX: 300, clientY: 240 };
    expect(finishRecordingDrag(gesture, up, { overBoard: true, overNode: true })).toBeNull();
    expect(finishRecordingDrag(gesture, up, { overBoard: false, overNode: false })).toBeNull();
    expect(finishRecordingDrag(gesture, { ...up, ctrlKey: true }, { overBoard: true, overNode: false })).toBe("copy");
    expect(finishRecordingDrag(gesture, up, { overBoard: true, overNode: false })).toBe("move");
    expect(finishRecordingDrag(beginRecordingDrag(down), { ...down, clientX: 12 }, { overBoard: true, overNode: false })).toBeNull();
  });

  it("copies a row on Ctrl-drop without removing the source recording", () => {
    const source = recording("copy", "Voice memo");
    const gesture = moveRecordingDrag(beginRecordingDrag({ pointerId: 5, clientX: 0, clientY: 0 }), {
      pointerId: 5,
      clientX: 10,
      clientY: 0,
    });
    const action = finishRecordingDrag(gesture, { pointerId: 5, clientX: 100, clientY: 80, ctrlKey: true }, {
      overBoard: true,
      overNode: false,
    });
    expect(action).toBe("copy");

    const note = droppedAudioNote(source, { x: 50, y: 30 }, ["Voice memo"], "copy-audio");
    const rows = [source];
    const notes = new Map<string, typeof note>();
    const history = new HistoryStack();
    history.execute(droppedAudioNoteCommand(note, (added) => notes.set(added.id, added), (id) => notes.delete(id)));
    expect(rows).toEqual([source]);
    expect(notes.get(note.id)).toEqual(note);
    history.undo();
    expect(rows).toEqual([source]);
    expect(notes.has(note.id)).toBe(false);
  });

  it("moves a recording into a standalone audio node and restores both sides in one Undo", () => {
    const source = recording("d", "Field notes");
    const note = droppedAudioNote(source, { x: 50, y: 30 }, ["Field notes"], "drop-audio");
    expect(note).toMatchObject({
      id: "drop-audio",
      type: "audio",
      name: "Field notes 2",
      x: 33,
      y: 22,
      media: source.media,
    });
    let recordings = [source];
    let selected = "dictaphone";
    const notes = new Map<string, typeof note>();
    const history = new HistoryStack();
    history.execute(pulledOutRecordingCommand(note, recordings, [], {
      applyRecordings: (next) => { recordings = next; },
      addNote: (added) => notes.set(added.id, added),
      removeNote: (id) => { notes.delete(id); },
      selectCreated: () => { selected = note.id; },
      restoreSelection: () => { selected = "dictaphone"; },
    }));
    expect(notes.get(note.id)).toEqual(note);
    expect(recordings).toEqual([]);
    expect(selected).toBe(note.id);
    expect(history.entries).toHaveLength(1);
    history.undo();
    expect(notes.has(note.id)).toBe(false);
    expect(recordings).toEqual([source]);
    expect(selected).toBe("dictaphone");
    history.redo();
    expect(notes.get(note.id)).toEqual(note);
    expect(recordings).toEqual([]);
  });
});
