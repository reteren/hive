import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { HistoryStack } from "../src/history/historyStack";
import { clear as clearHistory, redo, undo, history } from "../src/history/history.svelte";
import { board, replaceBoard } from "../src/model/board.svelte";
import { links, replaceLinks } from "../src/model/links.svelte";
import type { Link } from "../src/model/link";
import { MOOD_KINDS, type Note, type MoodKind } from "../src/model/note";
import {
  createMoodToggleCommand,
  effectiveMoodsFor,
  moduleRowsFor,
  MOOD_OPTIONS,
  type ModuleDataWriter,
} from "../src/modules/moduleLogic";
import {
  effectiveMoods,
  extractModuleFromNote,
  moduleDropPreview,
  toggleMood,
  tryInsertModuleOnDrop,
  updateModuleDropPreview,
} from "../src/modules/moduleActions.svelte";
import { effectiveLinkKind, linkRefusalReason } from "../src/links/rules";
import { modulePicker, closeModulePicker, toggleModulePicker } from "../src/modules/pickerState.svelte";
import { mergeLoadedNotes, parseProjectIndex, serializeProjectIndex } from "../src/project/index";
import { tool } from "../src/tools/tool.svelte";
import { parseNotesPayload, serializeNotes } from "../src/clipboard/payload";

function note({ id, type = "note", ...overrides }: Partial<Note> & Pick<Note, "id"> & { type?: Note["type"] }): Note {
  return {
    id,
    type,
    name: overrides.name ?? id,
    text: "",
    x: 0,
    y: 0,
    width: type === "mood" ? 14 : 30,
    height: type === "mood" ? 4 : 20,
    ...overrides,
  };
}

function link(from: string, to: string, id = from + "-" + to): Link {
  return { id, from, to, kind: "strong", shape: "base" };
}

function reset(): void {
  replaceBoard([]);
  replaceLinks([]);
  clearHistory();
  closeModulePicker();
}

beforeEach(reset);
afterEach(reset);

describe("Mood modules", () => {
  it("defines one distinct readable color and English label per mood without pictograms", () => {
    expect(MOOD_OPTIONS.map(({ id }) => id)).toEqual(MOOD_KINDS);
    expect(new Set(MOOD_OPTIONS.map(({ color }) => color)).size).toBe(MOOD_KINDS.length);
    expect(MOOD_OPTIONS.map(({ label }) => label)).toContain("Happiness");
    expect(MOOD_OPTIONS.every(({ iconPath }) => iconPath === undefined)).toBe(true);
  });

  it("resolves embedded and strong-linked values as an ordered union", () => {
    const target = note({ id: "target", type: "note", moods: ["joy", "curiosity"] });
    const first = note({ id: "first", type: "mood", moods: ["love", "joy"] });
    const second = note({ id: "second", type: "mood", moods: ["relief"] });
    const weak = note({ id: "weak", type: "mood", moods: ["anger"] });
    const notes = { target, first, second, weak };
    const edges = [
      { from: "target", to: "first", kind: "strong" as const },
      { from: "second", to: "target", kind: "strong" as const },
      { from: "target", to: "weak", kind: "weak" as const },
    ];

    expect(effectiveMoodsFor("target", notes, edges)).toEqual(["joy", "curiosity", "love", "relief"]);
  });

  it("toggles picker open and closed on repeated chip activation", () => {
    toggleModulePicker("target", "mood");
    expect(modulePicker).toMatchObject({ noteId: "target", kind: "mood" });
    toggleModulePicker("target", "mood");
    expect(modulePicker).toMatchObject({ noteId: null, kind: null });
    toggleModulePicker("target", "purpose");
    toggleModulePicker("other", "mood");
    expect(modulePicker).toMatchObject({ noteId: "other", kind: "mood" });
  });

  it("keeps a standalone Mood picker open through several reversible selections", () => {
    replaceBoard([note({ id: "mood", type: "mood", moods: ["fear"] })]);
    toggleModulePicker("mood", "mood");
    toggleMood("mood", "joy");
    toggleMood("mood", "love");

    expect(board.notes.mood?.moods).toEqual(["fear", "joy", "love"]);
    expect(modulePicker).toMatchObject({ noteId: "mood", kind: "mood" });
    expect(history.cursor).toBe(2);
    undo();
    expect(board.notes.mood?.moods).toEqual(["fear", "joy"]);
    expect(modulePicker.kind).toBe("mood");
  });

  it("reports only populated rows in Importance, Purpose, Mood order", () => {
    expect(moduleRowsFor(null, [], [])).toEqual([]);
    expect(moduleRowsFor("basic", [], ["joy"])).toEqual(["importance", "mood"]);
    expect(moduleRowsFor(null, ["quote"], ["anger", "relief"])).toEqual(["purpose", "mood"]);
  });

  it("applies and undoes a Mood module insertion as one operation", () => {
    const target = note({ id: "target", name: "Target", moods: ["joy"] });
    const module = note({ id: "shared-mood", type: "mood", moods: ["curiosity", "joy"], x: 50 });
    const edge = link(module.id, target.id);
    replaceBoard([target, module]);
    replaceLinks([edge]);

    expect(tryInsertModuleOnDrop(module.id, { x: 5, y: 5 })).toBe(true);
    expect(board.notes.target?.moods).toEqual(["joy", "curiosity"]);
    expect(board.notes[module.id]).toBeUndefined();
    expect(Object.keys(links.byId)).toEqual([]);
    expect(history.cursor).toBe(1);
    expect(history.entries.at(-1)?.label).toBe("Insert Mood");

    undo();
    expect(board.notes.target?.moods).toEqual(["joy"]);
    expect(board.notes[module.id]?.moods).toEqual(["curiosity", "joy"]);
    expect(links.byId[edge.id]).toEqual(edge);
    redo();
    expect(effectiveMoods("target")).toEqual(["joy", "curiosity"]);
  });

  it("previews and inserts one shared Mood target while preserving the other target", () => {
    const first = note({ id: "first", moods: ["joy"] });
    const second = note({ id: "second", x: 40 });
    const module = note({ id: "shared", type: "mood", moods: ["fear", "joy"], x: 80 });
    const firstLink = link("shared", "first", "first-link");
    const secondLink = link("shared", "second", "second-link");
    replaceBoard([first, second, module]);
    replaceLinks([firstLink, secondLink]);

    updateModuleDropPreview("shared", { x: 5, y: 5 });
    expect(moduleDropPreview).toMatchObject({ targetId: "first", allowed: true });
    expect(tryInsertModuleOnDrop("shared", { x: 5, y: 5 })).toBe(true);
    expect(board.notes.first?.moods).toEqual(["joy", "fear"]);
    expect(board.notes.shared?.moods).toEqual(["fear", "joy"]);
    expect(links.byId["first-link"]).toBeUndefined();
    expect(links.byId["second-link"]).toEqual(secondLink);
    expect(history.entries).toHaveLength(1);

    undo();
    expect(board.notes.first?.moods).toEqual(["joy"]);
    expect(links.byId["first-link"]).toEqual(firstLink);
    expect(links.byId["second-link"]).toEqual(secondLink);
  });

  it("extracts an embedded Mood with a strong edge and restores it through Undo/Redo", () => {
    const target = note({ id: "target", moods: ["happiness", "sadness"] });
    replaceBoard([target]);

    const previousShape = tool.lineShape;
    try {
      tool.lineShape = "wave";
      expect(extractModuleFromNote("target", "mood", "sadness", { x: 50, y: 15 })).toBe(true);
    } finally {
      tool.lineShape = previousShape;
    }
    expect(board.notes.target?.moods).toEqual(["happiness"]);
    const module = Object.values(board.notes).find((candidate) => candidate.type === "mood");
    expect(module).toMatchObject({ type: "mood", moods: ["sadness"], text: "" });
    expect(Object.values(links.byId)[0]).toMatchObject({ from: module?.id, to: "target", kind: "strong", shape: "base" });
    expect(history.entries.at(-1)?.label).toBe("Extract Mood");

    undo();
    expect(Object.values(board.notes)).toEqual([target]);
    expect(Object.values(links.byId)).toEqual([]);
    redo();
    expect(board.notes.target?.moods).toEqual(["happiness"]);
  });

  it("accepts a weak-tool request as a strong Mood link in either direction", () => {
    const content = note({ id: "content" });
    const mood = note({ id: "mood", type: "mood", moods: ["fear"] });
    const notes = { content, mood };
    expect(linkRefusalReason("mood", "content", "weak", [], notes)).toBeNull();
    expect(linkRefusalReason("content", "mood", "weak", [], notes)).toBeNull();
    expect(effectiveLinkKind("mood", "content", "weak", notes)).toBe("strong");
    expect(effectiveLinkKind("content", "mood", "weak", notes)).toBe("strong");
  });

  it("round trips Mood values and standalone kind through the v2 project index", () => {
    const values: Note[] = [
      note({ id: "note", name: "Note", moods: ["joy", "relief"] }),
      note({ id: "mood", type: "mood", name: "Curious", moods: ["curiosity"] }),
    ];
    const parsed = parseProjectIndex(serializeProjectIndex(values));
    expect(parsed.notes.map(({ type, moods }) => ({ type, moods }))).toEqual([
      { type: "note", moods: ["joy", "relief"] },
      { type: "mood", moods: ["curiosity"] },
    ]);
    const loaded = mergeLoadedNotes(parsed, values.map(({ id, name, text, x, y, width, height }) => ({
      id, name, text, file: name + ".md", x, y, width, height,
    })));
    expect(loaded).toMatchObject([values[0], { ...values[1], height: null }]);
    expect(loaded[1]?.type).toBe("mood");
    expect(loaded[1]?.moods).toEqual(["curiosity"]);
  });

  it("round trips embedded and standalone Moods through the clipboard payload", () => {
    const values = [
      note({ id: "note", moods: ["joy", "relief"] }),
      note({ id: "mood", type: "mood", moods: ["curiosity"] }),
    ];
    expect(parseNotesPayload(serializeNotes(values))?.nodes.map(({ type, moods }) => ({ type, moods }))).toEqual([
      { type: "note", moods: ["joy", "relief"] },
      { type: "mood", moods: ["curiosity"] },
    ]);
  });

  it("records Mood multi-toggles in insertion order and restores them exactly", () => {
    const target = note({ id: "target", moods: ["anger"] });
    const writer: ModuleDataWriter = (_noteId, patch) => {
      if ("moods" in patch) target.moods = patch.moods ? [...patch.moods] : undefined;
    };
    const stack = new HistoryStack();
    for (const mood of ["joy", "curiosity", "joy"] as const) {
      const command = createMoodToggleCommand(target, mood, writer);
      if (!command) throw new Error("Expected a Mood command.");
      stack.execute(command);
    }
    expect(target.moods).toEqual(["anger", "curiosity"]);
    stack.undo();
    expect(target.moods).toEqual(["anger", "joy", "curiosity"]);
    stack.undo();
    expect(target.moods).toEqual(["anger", "joy"]);
  });
});
