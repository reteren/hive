import { describe, expect, it } from "vitest";
import { parseNotesPayload, serializeNotes } from "../src/clipboard/payload";
import type { Note, NoteKind } from "../src/model/note";

function note(type: NoteKind, extra: Partial<Note> = {}): Note {
  return { id: `id-${type}`, type, name: type, text: "", x: 1, y: 2, width: 30, height: null, createdAt: 1, ...extra };
}

describe("clipboard keeps organisational and view nodes (debug: they pasted back as plain notes)", () => {
  it.each(["markas", "archive", "trash", "list", "map", "glossary", "inbox", "random"] as NoteKind[])(
    "%s round-trips with its kind",
    (type) => {
      const parsed = parseNotesPayload(serializeNotes([note(type)]));
      expect(parsed).not.toBeNull();
      expect(parsed?.nodes[0]?.type).toBe(type);
    },
  );

  it("keeps list items, statistics, random pick, inbox group and custom marks", () => {
    const list = note("list", { listItems: [{ id: "a", targetId: null, label: "one" }], listStats: true });
    const random = note("random", { randomPick: { listId: "id-list", itemId: "a", pickedAt: 5 } });
    const inbox = note("inbox", { inboxGroup: "later" });
    const marks = note("markas", { customMarks: [{ id: "m", text: "Hot", color: "#ff0000" }], customMarkFrame: true });
    const original = serializeNotes([list, random, inbox, marks]);
    const parsed = parseNotesPayload(original);
    expect(parsed).not.toBeNull();
    const byType = Object.fromEntries((parsed?.nodes ?? []).map((node) => [node.type, node]));
    expect(byType.list?.listStats).toBe(true);
    expect(byType.list?.listItems?.length).toBe(1);
    expect(byType.random?.randomPick).toMatchObject({ listId: "id-list", itemId: "a" });
    expect(byType.inbox?.inboxGroup).toBe("later");
    expect(byType.markas?.customMarkFrame).toBe(true);
  });
});
