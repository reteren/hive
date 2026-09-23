import { ChangeSet, EditorSelection, Text } from "@codemirror/state";
import { describe, expect, it } from "vitest";
import { HistoryStack, type HistoryCommand } from "../src/history/historyStack";
import {
  applyTextEditEffects,
  captureTextEditEffects,
  registerTextEditParticipant,
} from "../src/transfer/textEditHooks";
import {
  createTextEditRecord,
  mergeTextEditRecords,
  replayTextEditRecord,
} from "../src/editor/textEditHistory";

function selection(position: number): EditorSelection {
  return EditorSelection.create([EditorSelection.cursor(position)]);
}

describe("Text → Task edit history", () => {
  it("undoes and redoes the source and dependent task together after typing merges", () => {
    let sourceText = "a";
    let taskText = "task draft";
    const unregister = registerTextEditParticipant({
      id: "transfer-history-test",
      capture(noteId, _before, after) {
        if (noteId !== "source" || taskText === after) return [];
        return [{
          key: "source→task",
          before: taskText,
          after,
          apply: (text) => { taskText = text; },
        }];
      },
    });

    try {
      const stack = new HistoryStack();
      function type(insert: string, at: number, group: number): void {
        const before = Text.of([sourceText]);
        const forward = ChangeSet.of([{ from: before.length, to: before.length, insert }], before.length);
        const after = forward.apply(before);
        const edit = createTextEditRecord({
          noteId: "source",
          target: "Source",
          before,
          after,
          forward,
          selectionBefore: selection(before.length),
          selectionAfter: selection(after.length),
          kind: "typing",
          at,
          group,
        });
        edit.transferEffects = captureTextEditEffects("source", before.toString(), after.toString());
        sourceText = after.toString();
        applyTextEditEffects(edit.transferEffects, "redo");

        const command: HistoryCommand & { edit: typeof edit } = {
          label: "Edit text",
          target: "Source",
          edit,
          do() {
            replayTextEditRecord(this.edit, "redo", (text) => { sourceText = text; });
          },
          undo() {
            replayTextEditRecord(this.edit, "undo", (text) => { sourceText = text; });
          },
          merge(next) {
            if (!("edit" in next)) return false;
            const merged = mergeTextEditRecords(this.edit, (next as typeof command).edit);
            if (!merged) return false;
            this.edit = merged;
            return true;
          },
        };
        stack.record(command);
      }

      type("b", 100, 0);
      type("c", 150, 0);
      expect(sourceText).toBe("abc");
      expect(taskText).toBe("abc");
      expect(stack.entries).toHaveLength(1);

      stack.undo();
      expect(sourceText).toBe("a");
      expect(taskText).toBe("task draft");

      stack.redo();
      expect(sourceText).toBe("abc");
      expect(taskText).toBe("abc");
    } finally {
      unregister();
    }
  });
});
