import { describe, expect, it } from "vitest";
import { buildNoteEditorContextMenu, type NoteMenuEntry, type NoteMenuItem } from "../src/spell/noteEditorContextMenuModel";

function itemIds(entries: NoteMenuEntry[]): string[] {
  return entries.flatMap((entry) => {
    if ("separator" in entry) return [];
    if ("kind" in entry) return entry.items.flatMap((item) => "separator" in item ? [] : [item.id]);
    return [entry.id];
  });
}

describe("note editor context menu model", () => {
  it("puts spelling actions first, then MarkNote submenus and editing commands", () => {
    const entries = buildNoteEditorContextMenu({
      hasSelection: true,
      spellContext: { from: 4, to: 7, word: "teh", languages: ["en"] },
      suggestions: ["the", "ten"],
    });

    expect(entries.slice(0, 3).map((entry) => "separator" in entry ? "separator" : entry.label)).toEqual([
      "the", "ten", "Add to dictionary",
    ]);
    expect(entries.slice(3, 6).map((entry) => "separator" in entry ? "separator" : entry.label)).toEqual([
      "separator", "Formatting", "Paragraph",
    ]);
    expect(entries.filter((entry) => "kind" in entry).map((entry) => entry.label)).toEqual([
      "Formatting", "Paragraph", "Insert",
    ]);
    expect(itemIds(entries)).toEqual(expect.arrayContaining([
      "format.bold", "format.highlight", "format.clearFormatting", "format.taskList",
      "format.heading6", "format.clearHeading", "format.table", "format.mathBlock",
      "edit.pastePlainText", "select-all",
    ]));
    expect(itemIds(entries)).not.toContain("image.add");
    expect(entries.map((entry) => "separator" in entry ? "" : "kind" in entry ? entry.label : entry.label).join(" ")).not.toMatch(/add image/iu);
    expect(entries.slice(-7).map((entry) => "separator" in entry ? "separator" : entry.label)).toEqual([
      "separator", "Cut", "Copy", "Paste", "Paste as Plain Text", "Delete", "Select All",
    ]);
  });

  it("greys selection-only actions without a selection and includes link actions contextually", () => {
    const entries = buildNoteEditorContextMenu({ hasSelection: false, linkUrl: "https://example.test" });
    const rootItems = entries.filter((entry): entry is NoteMenuItem => !("separator" in entry) && !("kind" in entry));
    expect(rootItems.find((entry) => entry.id === "cut")?.disabled).toBe(true);
    expect(rootItems.find((entry) => entry.id === "copy")?.disabled).toBe(true);
    expect(rootItems.find((entry) => entry.id === "delete")?.disabled).toBe(true);
    expect(itemIds(entries)).toEqual(expect.arrayContaining(["link.open", "link.copy"]));
    expect(rootItems.find((entry) => entry.id === "edit.pastePlainText")?.shortcut).toBe("Ctrl+Shift+V");
  });
});
