import { describe, expect, it } from "vitest";
import { fuzzyMatchScore, searchCommands } from "../src/commands/commandSearch";

const commands = [
  { id: "view.home", label: "Home view" },
  { id: "ui.keymap", label: "Edit Key Bindings" },
  { id: "notes.renameSequence", label: "Rename Selection Sequentially" },
];

describe("command search", () => {
  it("matches label prefixes and keeps close matches first", () => {
    expect(searchCommands(commands, "rename").map(({ id }) => id)).toEqual(["notes.renameSequence"]);
    expect(searchCommands(commands, "key bind").map(({ id }) => id)).toEqual(["ui.keymap"]);
  });

  it("fuzzy-matches subsequences and stable command ids", () => {
    expect(fuzzyMatchScore("rns", "Rename Selection Sequentially")).not.toBeNull();
    expect(searchCommands(commands, "notes.renameseq").map(({ id }) => id)).toContain("notes.renameSequence");
  });

  it("returns every command alphabetically for an empty query and no results for a miss", () => {
    expect(searchCommands(commands, "").map(({ label }) => label)).toEqual([
      "Edit Key Bindings",
      "Home view",
      "Rename Selection Sequentially",
    ]);
    expect(searchCommands(commands, "zzzz")).toEqual([]);
  });
});
