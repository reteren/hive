import { beforeEach, describe, expect, it } from "vitest";
import { clear, redo, undo } from "../src/history/history.svelte";
import { board, replaceBoard } from "../src/model/board.svelte";
import { links, replaceLinks } from "../src/model/links.svelte";
import type { Link } from "../src/model/link";
import type { Note } from "../src/model/note";
import { keepTaskText, replaceTransferText } from "../src/transfer/sync.svelte";

function makeNote(id: string, text: string, task = false): Note {
  return {
    id,
    type: "note",
    name: id === "source" ? "Source note" : "Task note",
    text,
    x: 0,
    y: 0,
    width: 30,
    height: null,
    ...(task ? { task: { done: false, doneAt: null } } : {}),
  };
}

const link: Link = {
  id: "transfer-link",
  from: "source",
  to: "task",
  kind: "strong",
  shape: "base",
};

function setup(): void {
  clear();
  replaceBoard([makeNote("source", "new source text"), makeNote("task", "my draft", true)]);
  replaceLinks([{ ...link }]);
}

describe("Text → Task confirmation choices", () => {
  beforeEach(setup);

  it("Replace copies the source as its own reversible history step", () => {
    replaceTransferText(link.id);
    expect(historyState().taskText).toBe("new source text");
    expect(historyState().choice).toBe(false);
    expect(links.byId[link.id]?.transferOriginalText).toBe("my draft");

    undo();
    expect(historyState().taskText).toBe("my draft");
    expect(historyState().choice).toBeUndefined();
    expect(links.byId[link.id]?.transferOriginalText).toBeUndefined();

    redo();
    expect(historyState().taskText).toBe("new source text");
    expect(historyState().choice).toBe(false);
    expect(links.byId[link.id]?.transferOriginalText).toBe("my draft");
  });

  it("Keep preserves task text, persists the declined choice, and supports Undo/Redo", () => {
    keepTaskText(link.id);
    expect(historyState().taskText).toBe("my draft");
    expect(historyState().choice).toBe(true);

    undo();
    expect(historyState().taskText).toBe("my draft");
    expect(historyState().choice).toBeUndefined();

    redo();
    expect(historyState().taskText).toBe("my draft");
    expect(historyState().choice).toBe(true);
  });
});

function historyState(): { taskText: string; choice: boolean | undefined } {
  return {
    taskText: board.notes.task?.text ?? "missing",
    choice: links.byId[link.id]?.transferDeclined,
  };
}
