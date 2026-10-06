import { EditorSelection, EditorState } from "@codemirror/state";
import type { EditorView } from "@codemirror/view";
import { describe, expect, it } from "vitest";
import { toggleMarkdownLines } from "../src/editor/markdownCommands";
import { noteEditorKeyBindings } from "../src/editor/noteEditorKeymap";

function fakeView(doc: string, anchor = 0, head = doc.length): { view: EditorView; text: () => string } {
  let state = EditorState.create({ doc, selection: EditorSelection.single(anchor, head) });
  const view = {
    get state() { return state; },
    dispatch(spec: Parameters<EditorState["update"]>[0]) { state = state.update(spec).state; },
  } as unknown as EditorView;
  return { view, text: () => state.doc.toString() };
}

describe("note editor Markdown actions", () => {
  it("toggles checklist and quote markers across the selected lines", () => {
    const { view, text } = fakeView("first\nsecond");
    toggleMarkdownLines(view, "task");
    expect(text()).toBe("- [ ] first\n- [ ] second");
    toggleMarkdownLines(view, "task");
    expect(text()).toBe("first\nsecond");
    toggleMarkdownLines(view, "quote");
    expect(text()).toBe("> first\n> second");
    toggleMarkdownLines(view, "quote");
    expect(text()).toBe("first\nsecond");
  });

  it("replaces existing list markers when changing list type", () => {
    const { view, text } = fakeView("- item\n- next");
    toggleMarkdownLines(view, "ordered");
    expect(text()).toBe("1. item\n2. next");
  });

  it("binds MarkNote editing, formatting, and list shortcuts", () => {
    const bindings = noteEditorKeyBindings({
      exit: () => true,
      undo: () => true,
      redo: () => true,
      highlight: () => true,
    });
    const keys = new Set(bindings.map((binding) => binding.key).filter((key): key is string => Boolean(key)));
    for (const key of [
      "Mod-b", "Mod-i", "Mod-Shift-x", "Mod-e", "Mod-k", "Mod-Shift-k", "Mod-d",
      "Mod-1", "Mod-2", "Mod-3", "Mod-4", "Mod-5", "Mod-6", "Mod-0",
      "Mod-Shift-7", "Mod-Shift-8", "Mod-Shift-9", "Mod-Shift-.",
      "Tab", "Shift-Tab", "Shift-Enter", "Enter", "Backspace", "Alt-Backspace",
      "Alt-ArrowUp", "Alt-ArrowDown", "Mod-Shift-v",
    ]) expect(keys.has(key), key).toBe(true);
  });
});
