import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { clear, history, undo } from "../src/history/history.svelte";
import { board, replaceBoard } from "../src/model/board.svelte";
import type { Note } from "../src/model/note";
import { noteMenuItems } from "../src/notes/noteMenu";
import { suppressYoutubeContextMenu, youtubeCaptureAction, youtubeLoopRestart } from "../src/youtube/interaction";
import "../src/youtube/init";

const note: Note = {
  id: "youtube-1",
  type: "youtube",
  name: "YouTube test",
  text: "",
  x: 0,
  y: 0,
  width: 48,
  height: null,
  youtube: { videoId: "abcdefghijk", url: "https://youtu.be/abcdefghijk" },
};

beforeEach(() => {
  clear();
  replaceBoard([structuredClone(note)]);
});

afterEach(() => {
  clear();
  replaceBoard([]);
});

describe("YouTube player interaction", () => {
  it("suppresses the browser menu without stopping the board's capture route", () => {
    let prevented = false;
    let stopped = false;
    const contextEvent = {
      preventDefault: () => { prevented = true; },
      stopPropagation: () => { stopped = true; },
    };
    suppressYoutubeContextMenu(contextEvent);
    expect(prevented).toBe(true);
    expect(stopped).toBe(false);
    expect(noteMenuItems(note.id).some(({ id }) => id === "youtube.toggleLoop")).toBe(true);
  });

  it("uses the board drag threshold so a stationary click plays and a drag moves", () => {
    expect(youtubeCaptureAction({ x: 10, y: 10 }, { x: 13, y: 10 })).toBe("click");
    expect(youtubeCaptureAction({ x: 10, y: 10 }, { x: 14, y: 10 })).toBe("move");
  });

  it("restarts only an ended looping player from its configured start point", () => {
    expect(youtubeLoopRestart(0, true, 42)).toBe(42);
    expect(youtubeLoopRestart(0, true, undefined)).toBe(0);
    expect(youtubeLoopRestart(1, true, 42)).toBeNull();
    expect(youtubeLoopRestart(0, undefined, 42)).toBeNull();
  });

  it("registers Loop video and frame toggles as undoable note-menu actions", () => {
    const items = noteMenuItems(note.id);
    const loop = items.find((item) => item.id === "youtube.toggleLoop");
    const frame = items.find((item) => item.id === "youtube.toggleFrame");
    expect(loop?.label(note.id)).toBe("Loop video");
    expect(frame?.label(note.id)).toBe("Hide node frame");
    expect(loop).toBeDefined();
    expect(frame).toBeDefined();

    loop!.run(note.id);
    expect(board.notes[note.id]?.youtube?.loop).toBe(true);
    expect(loop!.label(note.id)).toBe("Stop looping");
    frame!.run(note.id);
    expect(board.notes[note.id]?.frameHidden).toBe(true);
    expect(frame!.label(note.id)).toBe("Show node frame");
    expect(history.entries).toHaveLength(2);

    undo();
    expect(board.notes[note.id]?.frameHidden).toBeUndefined();
    undo();
    expect(board.notes[note.id]?.youtube?.loop).toBeUndefined();
  });
});
