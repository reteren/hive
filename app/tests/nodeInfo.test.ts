import { describe, expect, it } from "vitest";
import { collectionStats, formatAgo, formatBytes, formatClock, formatOf, formatSpan, mediaFacts, taskStats, textStats } from "../src/info/nodeInfoLogic";
import type { Note } from "../src/model/note";

const note = (extra: Partial<Note> = {}): Note => ({ id: "n", type: "note", name: "N", text: "", x: 0, y: 0, width: 25, height: null, ...extra } as Note);

describe("node info", () => {
  it("counts words, characters, lines and reading time without counting markup as words", () => {
    expect(textStats("# Title\n\n- **bold** item and [a link](https://x.y)\n")).toEqual({ words: 6, characters: 51, lines: 3, readingMinutes: 1 });
    expect(textStats("")).toEqual({ words: 0, characters: 0, lines: 0, readingMinutes: 0 });
    expect(textStats("слово ".repeat(500)).readingMinutes).toBe(3);
  });

  it("counts list rows and inbox entries with how many of their tasks are done", () => {
    const notes = {
      a: note({ id: "a", task: { done: true, doneAt: 1 } as Note["task"] }),
      b: note({ id: "b", task: { done: false, doneAt: null } as Note["task"] }),
    };
    const list = note({ id: "l", type: "list", listItems: [{ id: "1", targetId: "a", label: "" }, { id: "2", targetId: "b", label: "" }, { id: "3", targetId: null, label: "x" }] });
    expect(collectionStats(list, notes, [])).toEqual({ items: 3, done: 1 });
    const inbox = note({ id: "i", type: "inbox" });
    const links = [{ id: "k1", from: "i", to: "a", kind: "strong" }, { id: "k2", from: "i", to: "b", kind: "strong" }, { id: "k3", from: "i", to: "gone", kind: "strong" }] as never;
    expect(collectionStats(inbox, notes, links)).toEqual({ items: 2, done: 1 });
    expect(collectionStats(note(), notes, [])).toBeNull();
  });

  it("reports when a task was closed, how long it took and how often it was completed", () => {
    const task = note({ createdAt: 1_000, task: { done: true, doneAt: 61_000 } as Note["task"] });
    const log = [{ noteId: "n", name: "N", doneAt: 5_000 }, { noteId: "n", name: "N", doneAt: 61_000 }, { noteId: "other", name: "O", doneAt: 1 }];
    expect(taskStats(task, log)).toEqual({ doneAt: 61_000, openForMs: 60_000, timesCompleted: 2 });
    expect(taskStats(note(), log)).toBeNull();
  });

  it("describes media files", () => {
    const image = note({ type: "image", image: { file: "cat.png", mime: "image/png", size: 10, name: "Cat.png", naturalWidth: 640, naturalHeight: 480 } });
    expect(mediaFacts(image)).toEqual({ name: "Cat.png", format: "PNG", width: 640, height: 480, durationSeconds: null, files: ["cat.png"] });
    const audio = note({ type: "audio", media: { file: "a.mp3", mime: "audio/mpeg", size: 1, kind: "audio", duration: 75 } as Note["media"] });
    expect(mediaFacts(audio)).toMatchObject({ format: "MP3", durationSeconds: 75, files: ["a.mp3"] });
    expect(formatOf("video/quicktime")).toBe("MOV");
  });

  it("formats sizes, spans and ages", () => {
    expect(formatBytes(512)).toBe("512 B");
    expect(formatBytes(1536)).toBe("1.5 KB");
    expect(formatClock(75)).toBe("1:15");
    expect(formatClock(3723)).toBe("1:02:03");
    expect(formatSpan(45_000)).toBe("45 s");
    expect(formatSpan(3 * 3_600_000 + 5 * 60_000)).toBe("3 h 5 min");
    expect(formatSpan(4 * 86_400_000)).toBe("4 days");
    const now = 10_000_000_000;
    expect(formatAgo(now - 2 * 3_600_000, now)).toBe("2 hours ago");
    expect(formatAgo(now - 10_000, now)).toBe("just now");
  });
});
