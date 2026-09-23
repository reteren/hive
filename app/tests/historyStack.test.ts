import { describe, expect, it } from "vitest";
import {
  DEFAULT_HISTORY_LIMIT,
  HistoryStack,
  MAX_HISTORY_LIMIT,
  MIN_HISTORY_LIMIT,
  type HistoryCommand,
} from "../src/history/historyStack";

function increment(value: { current: number }, label: string, by = 1): HistoryCommand {
  return {
    label,
    do: () => { value.current += by; },
    undo: () => { value.current -= by; },
  };
}

describe("HistoryStack", () => {
  it("drops the Redo branch after a successful new edit", () => {
    const value = { current: 0 };
    const stack = new HistoryStack();
    stack.execute(increment(value, "First"));
    stack.execute(increment(value, "Second"));
    stack.undo();

    expect(value.current).toBe(1);
    stack.execute(increment(value, "Replacement"));

    expect(stack.entries.map(({ label }) => label)).toEqual(["First", "Replacement"]);
    expect(stack.cursor).toBe(2);
    expect(stack.redo()).toBeUndefined();
    expect(value.current).toBe(2);
  });

  it("merges consecutive edits into one undoable entry", () => {
    const value = { current: 0 };
    type Edit = HistoryCommand & { delta: number };
    const edit = (delta: number): Edit => {
      let total = delta;
      return {
        label: "Edit text",
        delta,
        do: () => { value.current += total; },
        undo: () => { value.current -= total; },
        merge(next) {
          if (next.label !== "Edit text" || !("delta" in next)) return false;
          total += (next as Edit).delta;
          return true;
        },
      };
    };
    const stack = new HistoryStack();

    stack.execute(edit(2));
    stack.execute(edit(3));

    expect(stack.entries).toHaveLength(1);
    expect(stack.cursor).toBe(1);
    expect(value.current).toBe(5);
    stack.undo();
    expect(value.current).toBe(0);
    stack.redo();
    expect(value.current).toBe(5);
  });

  it("keeps the newest entries when the limit is reached or reduced", () => {
    const value = { current: 0 };
    const stack = new HistoryStack(MIN_HISTORY_LIMIT);
    for (let index = 1; index <= MIN_HISTORY_LIMIT + 1; index += 1) {
      stack.execute(increment(value, String(index)));
    }

    expect(stack.entries.map(({ label }) => label)).toEqual(
      Array.from({ length: MIN_HISTORY_LIMIT }, (_, index) => String(index + 2)),
    );
    expect(stack.cursor).toBe(MIN_HISTORY_LIMIT);
    stack.setLimit(MAX_HISTORY_LIMIT);
    expect(stack.limit).toBe(MAX_HISTORY_LIMIT);
    stack.setLimit(MIN_HISTORY_LIMIT);
    expect(stack.entries).toHaveLength(MIN_HISTORY_LIMIT);
    for (let index = 0; index < MIN_HISTORY_LIMIT; index += 1) stack.undo();
    expect(value.current).toBe(1);
  });

  it("moves to a selected state by running Undo and Redo step by step", () => {
    const value = { current: 0 };
    const stack = new HistoryStack();
    stack.execute(increment(value, "One"));
    stack.execute(increment(value, "Two"));
    stack.execute(increment(value, "Three"));

    expect(stack.jumpTo(1)).toBe(1);
    expect(value.current).toBe(1);
    expect(stack.jumpTo(3)).toBe(3);
    expect(value.current).toBe(3);
    expect(() => stack.jumpTo(4)).toThrow(RangeError);
  });

  it("does not move its cursor or drop Redo when command.do throws", () => {
    const value = { current: 0 };
    const stack = new HistoryStack();
    stack.execute(increment(value, "First"));
    stack.execute(increment(value, "Second"));
    stack.undo();
    const failing: HistoryCommand = {
      label: "Failure",
      do: () => { throw new Error("do failed"); },
      undo: () => undefined,
    };

    expect(() => stack.execute(failing)).toThrow("do failed");
    expect(stack.cursor).toBe(1);
    expect(stack.entries.map(({ label }) => label)).toEqual(["First", "Second"]);
    expect(stack.redo()?.label).toBe("Second");
    expect(value.current).toBe(2);
  });

  it("does not advance or rewind the cursor when command.do or command.undo throws", () => {
    const value = { current: 0 };
    const stack = new HistoryStack();
    let failUndo = true;
    let failRedo = false;
    stack.execute({
      label: "Toggle",
      do() {
        if (failRedo) throw new Error("redo failed");
        value.current += 1;
      },
      undo() {
        if (failUndo) throw new Error("undo failed");
        value.current -= 1;
      },
    });

    expect(() => stack.undo()).toThrow("undo failed");
    expect(stack.cursor).toBe(1);
    failUndo = false;
    stack.undo();
    expect(stack.cursor).toBe(0);

    failRedo = true;
    expect(() => stack.redo()).toThrow("redo failed");
    expect(stack.cursor).toBe(0);
    expect(value.current).toBe(0);
  });

  it("clears entries but preserves the configured limit", () => {
    const stack = new HistoryStack(32);
    stack.execute(increment({ current: 0 }, "One"));
    stack.clear();

    expect(stack.entries).toEqual([]);
    expect(stack.cursor).toBe(0);
    expect(stack.limit).toBe(32);
    expect(stack.limit).not.toBe(DEFAULT_HISTORY_LIMIT);
  });
});
