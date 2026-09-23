import { describe, expect, it } from "vitest";
import {
  commitSequentialRename,
  createSequentialRename,
  skipSequentialRename,
} from "../src/notes/sequentialRename";

describe("sequential rename state machine", () => {
  it("visits selected note ids once, in selection order", () => {
    const session = createSequentialRename(
      ["b", "a", "missing", "b"],
      { a: "Alpha", b: "Beta" },
    );

    expect(session).toEqual({
      items: [{ id: "b", name: "Beta" }, { id: "a", name: "Alpha" }],
      index: 0,
      draft: "Beta",
    });
    expect(createSequentialRename([], {})).toBeNull();
  });

  it("commits each rename independently and advances to the next original name", () => {
    const session = createSequentialRename(["a", "b"], { a: "Alpha", b: "Beta" });
    expect(session).not.toBeNull();
    const first = commitSequentialRename(session!, "First");

    expect(first.change).toEqual({ id: "a", previousName: "Alpha", nextName: "First" });
    expect(first.session).toEqual({
      items: [{ id: "a", name: "Alpha" }, { id: "b", name: "Beta" }],
      index: 1,
      draft: "Beta",
    });
    expect(commitSequentialRename(first.session!, "Beta")).toEqual({ session: null, change: null });
  });

  it("Escape skips only the current note and leaves prior committed changes intact", () => {
    const session = createSequentialRename(["a", "b"], { a: "Alpha", b: "Beta" });
    const committed = commitSequentialRename(session!, "Renamed");
    const skipped = skipSequentialRename(committed.session!);

    expect(committed.change?.nextName).toBe("Renamed");
    expect(skipped).toBeNull();
    expect(skipSequentialRename(session!)).toEqual({
      items: [{ id: "a", name: "Alpha" }, { id: "b", name: "Beta" }],
      index: 1,
      draft: "Beta",
    });
  });
});
