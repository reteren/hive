import { beforeEach, describe, expect, it } from "vitest";
import {
  beginHistoryTransaction,
  abortHistoryTransaction,
  commitHistoryTransaction,
  clear,
  execute,
  history,
  record,
  redo,
  undo,
} from "../src/history/history.svelte";

let value = "";
let events: string[] = [];

beforeEach(() => {
  clear();
  value = "";
  events = [];
});

describe("history transactions", () => {
  it("commits execute and text-editor records as one undoable and redoable entry", () => {
    beginHistoryTransaction("MCP: update a note");
    execute({
      label: "Rename",
      do: () => { value = "renamed"; events.push("rename"); },
      undo: () => { value = "original"; events.push("undo rename"); },
    });
    value = "renamed text";
    record({
      label: "Edit text",
      do: () => { value = "renamed text"; events.push("text"); },
      undo: () => { value = "renamed"; events.push("undo text"); },
    });

    commitHistoryTransaction();

    expect(history.entries).toHaveLength(1);
    expect(history.entries[0].label).toBe("MCP: update a note");
    expect(value).toBe("renamed text");
    undo();
    expect(value).toBe("original");
    expect(events.slice(-2)).toEqual(["undo text", "undo rename"]);
    redo();
    expect(value).toBe("renamed text");
    expect(events.slice(-2)).toEqual(["rename", "text"]);
  });

  it("aborts in reverse order and leaves the existing history unchanged", () => {
    execute({ label: "Before", do: () => { value = "before"; }, undo: () => { value = ""; } });
    beginHistoryTransaction("MCP: failed operation");
    execute({
      label: "First",
      do: () => { value += "-first"; events.push("first"); },
      undo: () => { value = "before"; events.push("undo first"); },
    });
    execute({
      label: "Second",
      do: () => { value += "-second"; events.push("second"); },
      undo: () => { value = "before-first"; events.push("undo second"); },
    });

    abortHistoryTransaction();

    expect(value).toBe("before");
    expect(events).toEqual(["first", "second", "undo second", "undo first"]);
    expect(history.entries.map((entry) => entry.label)).toEqual(["Before"]);
    expect(history.cursor).toBe(1);
  });

  it("does not merge a transaction composite into the previous history command", () => {
    let merges = 0;
    execute({
      label: "Typing",
      do: () => { value = "a"; },
      undo: () => { value = ""; },
      merge: () => { merges += 1; return true; },
    });
    beginHistoryTransaction("MCP: write");
    execute({ label: "Typing", do: () => { value = "b"; }, undo: () => { value = "a"; } });
    commitHistoryTransaction();

    expect(merges).toBe(0);
    expect(history.entries.map((entry) => entry.label)).toEqual(["Typing", "MCP: write"]);
  });

  it("keeps a nested transaction inside its outer transaction", () => {
    beginHistoryTransaction("MCP: batch");
    execute({ label: "First", do: () => { value += "first"; }, undo: () => { value = ""; } });
    beginHistoryTransaction("nested");
    execute({ label: "Second", do: () => { value += "second"; }, undo: () => { value = "first"; } });
    commitHistoryTransaction();
    execute({ label: "Third", do: () => { value += "third"; }, undo: () => { value = "firstsecond"; } });
    commitHistoryTransaction();

    expect(history.entries.map((entry) => entry.label)).toEqual(["MCP: batch"]);
    expect(value).toBe("firstsecondthird");
    undo();
    expect(value).toBe("");
    redo();
    expect(value).toBe("firstsecondthird");
  });
});
