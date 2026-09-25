import { ChangeSet, EditorSelection, Text } from "@codemirror/state";
import { describe, expect, it } from "vitest";
import {
  canMergeTextEditRecords,
  createTextEditRecord,
  mergeTextEditRecords,
  textEditKind,
} from "../src/editor/textEditHistory";

function selection(position: number): EditorSelection {
  return EditorSelection.create([EditorSelection.cursor(position)]);
}

function edit(
  text: string,
  from: number,
  to: number,
  insert: string,
  selectionBefore: EditorSelection,
  selectionAfter: EditorSelection,
  options: {
    at?: number;
    group?: number;
    noteId?: string;
    kind?: "typing" | "backspace" | "atomic";
    widthBefore?: number;
    widthAfter?: number;
  } = {},
) {
  const before = Text.of(text.split("\n"));
  const forward = ChangeSet.of([{ from, to, insert }], before.length);
  return createTextEditRecord({
    noteId: options.noteId ?? "note-1",
    target: "Note one",
    before,
    after: forward.apply(before),
    forward,
    selectionBefore,
    selectionAfter,
    kind: options.kind ?? "typing",
    at: options.at ?? 100,
    group: options.group ?? 0,
    widthBefore: options.widthBefore,
    widthAfter: options.widthAfter,
  });
}

describe("editor text history", () => {
  it("inverts a CodeMirror change set back to the original document", () => {
    const before = Text.of(["alpha beta"]);
    const forward = ChangeSet.of([{ from: 6, to: 10, insert: "hive" }], before.length);
    const after = forward.apply(before);

    expect(after.toString()).toBe("alpha hive");
    expect(forward.invert(before).apply(after).toString()).toBe(before.toString());
  });

  it("coalesces adjacent typing and keeps the inverse for the whole group", () => {
    const first = edit("", 0, 0, "h", selection(0), selection(1));
    const second = edit("h", 1, 1, "i", selection(1), selection(2), { at: 250 });
    const merged = mergeTextEditRecords(first, second);

    expect(merged?.before.toString()).toBe("");
    expect(merged?.after.toString()).toBe("hi");
    expect(merged?.forward.apply(first.before).toString()).toBe("hi");
    expect(merged?.inverse.apply(second.after).toString()).toBe("");
  });

  it("coalesces consecutive backspaces from the same caret", () => {
    const first = edit("ab", 1, 2, "", selection(2), selection(1), { kind: "backspace" });
    const second = edit("a", 0, 1, "", selection(1), selection(0), {
      kind: "backspace",
      at: 250,
    });
    const merged = mergeTextEditRecords(first, second);

    expect(merged?.after.toString()).toBe("");
    expect(merged?.inverse.apply(second.after).toString()).toBe("ab");
  });

  it("coalesces typing-driven width growth into the same history burst", () => {
    const first = edit("", 0, 0, "a", selection(0), selection(1), {
      widthBefore: 30,
      widthAfter: 34,
    });
    const second = edit("a", 1, 1, "b", selection(1), selection(2), {
      at: 250,
      widthBefore: 34,
      widthAfter: 41,
    });
    const merged = mergeTextEditRecords(first, second);

    expect(merged?.before.toString()).toBe("");
    expect(merged?.after.toString()).toBe("ab");
    expect([merged?.widthBefore, merged?.widthAfter]).toEqual([30, 41]);
  });

  it("breaks groups on note, caret, edit kind, group, or a pause over one second", () => {
    const first = edit("", 0, 0, "a", selection(0), selection(1));
    const matching = edit("a", 1, 1, "b", selection(1), selection(2), { at: 500 });
    expect(canMergeTextEditRecords(first, matching)).toBe(true);

    const otherNote = edit("a", 1, 1, "b", selection(1), selection(2), {
      noteId: "note-2",
    });
    const caretJump = edit("a", 1, 1, "b", selection(0), selection(2));
    const differentKind = edit("a", 1, 1, "b", selection(1), selection(2), {
      kind: "backspace",
    });
    const differentGroup = edit("a", 1, 1, "b", selection(1), selection(2), {
      group: 1,
    });
    const pause = edit("a", 1, 1, "b", selection(1), selection(2), { at: 1101 });

    expect(canMergeTextEditRecords(first, otherNote)).toBe(false);
    expect(canMergeTextEditRecords(first, caretJump)).toBe(false);
    expect(canMergeTextEditRecords(first, differentKind)).toBe(false);
    expect(canMergeTextEditRecords(first, differentGroup)).toBe(false);
    expect(canMergeTextEditRecords(first, pause)).toBe(false);
  });

  it("classifies only typing and backward delete as mergeable edit kinds", () => {
    expect(textEditKind("input.type")).toBe("typing");
    expect(textEditKind("delete.backward")).toBe("backspace");
    expect(textEditKind("delete.forward")).toBe("forward-delete");
    expect(textEditKind("input.format")).toBe("atomic");
  });
});
