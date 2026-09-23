import { describe, expect, it } from "vitest";
import type { ImportanceLevel, Note } from "../src/model/note";
import { HistoryStack } from "../src/history/historyStack";
import {
  IMPORTANCE_OPTIONS,
  PURPOSE_OPTIONS,
  createImportanceCommand,
  createPurposeToggleCommand,
  importanceMenuLabel,
  type ModuleDataPatch,
  type ModuleDataWriter,
} from "../src/modules/moduleLogic";

function writeTo(note: Note): ModuleDataWriter {
  return (noteId, patch) => {
    if (noteId !== note.id) return;
    for (const key of ["importance", "purposes"] as const) {
      if (!(key in patch)) continue;
      const value = patch[key];
      if (value === undefined) delete note[key];
      else if (key === "purposes") note.purposes = [...(value as NonNullable<ModuleDataPatch["purposes"]>)];
      else note.importance = value as ImportanceLevel | null | undefined;
    }
  };
}

function note(overrides: Partial<Note> = {}): Note {
  return {
    id: "note-1",
    type: "note",
    name: "Idea",
    text: "",
    x: 0,
    y: 0,
    width: 30,
    height: null,
    ...overrides,
  };
}

describe("inserted note modules", () => {
  it("keeps Importance in one slot and makes its command reversible", () => {
    const current = note({ importance: "basic" });
    const stack = new HistoryStack();
    const writer = writeTo(current);
    const change = createImportanceCommand(current, "immediately", writer);

    expect(IMPORTANCE_OPTIONS.map(({ id }) => id)).toEqual([
      "basic", "medium", "important", "immediately", "absolute",
    ]);
    expect(importanceMenuLabel(current)).toBe("Change Importance");
    expect(change?.label).toBe("Importance: immediately");

    if (!change) throw new Error("Expected an Importance command.");
    stack.execute(change);
    expect(current.importance).toBe("immediately");
    stack.undo();
    expect(current.importance).toBe("basic");
    stack.redo();
    expect(current.importance).toBe("immediately");

    const remove = createImportanceCommand(current, null, writer);
    if (!remove) throw new Error("Expected a Remove Importance command.");
    stack.execute(remove);
    expect(current.importance).toBeNull();
    stack.undo();
    expect(current.importance).toBe("immediately");
  });

  it("toggles Purpose values in insertion order and restores snapshots on Undo/Redo", () => {
    const current = note();
    const writer = writeTo(current);
    const stack = new HistoryStack();
    const toggle = (purpose: "quote" | "concept") => {
      const command = createPurposeToggleCommand(current, purpose, writer);
      if (!command) throw new Error(`Expected a Purpose command for ${purpose}.`);
      stack.execute(command);
    };

    expect(PURPOSE_OPTIONS.map(({ label }) => label)).toEqual([
      "Quote", "Concept", "Open question", "Decision", "Hypothesis", "Experiment", "Compare", "Timeline",
    ]);
    toggle("quote");
    toggle("concept");
    expect(current.purposes).toEqual(["quote", "concept"]);
    toggle("quote");
    expect(current.purposes).toEqual(["concept"]);
    expect(stack.cursor).toBe(3);

    stack.undo();
    expect(current.purposes).toEqual(["quote", "concept"]);
    stack.undo();
    expect(current.purposes).toEqual(["quote"]);
    stack.redo();
    expect(current.purposes).toEqual(["quote", "concept"]);
    stack.redo();
    expect(current.purposes).toEqual(["concept"]);
  });

  it("restores an absent optional field exactly after undo", () => {
    const current = note();
    const command = createPurposeToggleCommand(current, "timeline", writeTo(current));
    if (!command) throw new Error("Expected a Purpose command.");
    const stack = new HistoryStack();
    stack.execute(command);
    stack.undo();

    expect(Object.hasOwn(current, "purposes")).toBe(false);
  });
});
