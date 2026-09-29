import { describe, expect, it } from "vitest";
import archiveSource from "../src/archive/ArchiveNodeBody.svelte?raw";
import trashSource from "../src/trash/TrashNodeBody.svelte?raw";

const cases = [
  { source: trashSource, root: ".trash-node-body" },
  { source: archiveSource, root: ".archive-body" },
];

describe("trash and archive text selection", () => {
  for (const { source, root } of cases) {
    it(`disables selection in static ${root} content while keeping editable fields selectable`, () => {
      const escaped = root.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      expect(source).toMatch(new RegExp(`${escaped},\\s*${escaped} :global\\(\\*\\)\\s*\\{[^}]*user-select:\\s*none;`, "s"));
      expect(source).toMatch(new RegExp(`${escaped} :global\\(input:not\\(.*?\\)\\),\\s*${escaped} :global\\(textarea\\),\\s*${escaped} :global\\(\\[contenteditable="true"\\]\\)\\s*\\{[^}]*user-select:\\s*text;`, "s"));
    });
  }
});
