import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { clear, history, undo } from "../src/history/history.svelte";
import { board, replaceBoard } from "../src/model/board.svelte";
import type { Note } from "../src/model/note";
import { noteMenuItems } from "../src/notes/noteMenu";
import { videoCaptureAction } from "../src/video/logic";
import "../src/video/init";

const note: Note = {
  id: "local-video",
  type: "video",
  name: "Clip.mp4",
  text: "Caption",
  x: 0,
  y: 0,
  width: 48,
  height: null,
  media: {
    file: `${"a".repeat(64)}.mp4`,
    mime: "video/mp4",
    size: 1234,
    name: "Clip.mp4",
    kind: "video",
    duration: 8,
    naturalWidth: 1920,
    naturalHeight: 1080,
  },
};

beforeEach(() => {
  clear();
  replaceBoard([structuredClone(note)]);
});

afterEach(() => {
  clear();
  replaceBoard([]);
});

describe("video node interaction", () => {
  it("uses the board drag threshold for hidden-frame click and move gestures", () => {
    expect(videoCaptureAction({ x: 10, y: 10 }, { x: 13, y: 10 })).toBe("click");
    expect(videoCaptureAction({ x: 10, y: 10 }, { x: 14, y: 10 })).toBe("move");
  });

  it("registers frame visibility as an undoable video note-menu action", () => {
    const frame = noteMenuItems(note.id).find((item) => item.id === "video.toggleFrame");
    expect(frame?.label(note.id)).toBe("Hide node frame");
    expect(frame).toBeDefined();

    frame!.run(note.id);
    expect(board.notes[note.id]?.frameHidden).toBe(true);
    expect(frame!.label(note.id)).toBe("Show node frame");
    expect(history.entries).toHaveLength(1);

    undo();
    expect(board.notes[note.id]?.frameHidden).toBeUndefined();
    expect(frame!.label(note.id)).toBe("Hide node frame");
  });
});
