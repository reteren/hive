import { describe, expect, it } from "vitest";
import { LINE_JUMP_REPEAT_MS, nearestFractionOnPath, pickLineJumpEnd } from "../src/links/lineJump";
import { displayedLineText } from "../src/editor/textFitWidth";
import { nodesForSelectTap } from "../src/selection/selectByKey";
import { buildNoteEditorContextMenu } from "../src/spell/noteEditorContextMenuModel";

describe("click on a line jumps to its ends", () => {
  const base = { linkId: "l1", from: "a", to: "b", now: 1_000, last: null };

  it("goes to the end nearer to the clicked point along the line", () => {
    expect(pickLineJumpEnd({ ...base, fraction: 0.2 })).toBe("a");
    expect(pickLineJumpEnd({ ...base, fraction: 0.8 })).toBe("b");
  });

  it("a repeat click on the same line within 5 s goes to the other end, back and forth", () => {
    const last = { linkId: "l1", endId: "a", at: 1_000 };
    expect(pickLineJumpEnd({ ...base, fraction: 0.1, now: 3_000, last })).toBe("b");
    expect(pickLineJumpEnd({ ...base, fraction: 0.9, now: 3_000, last: { ...last, endId: "b" } })).toBe("a");
  });

  it("after 5 s or on another line the nearer end wins again", () => {
    const last = { linkId: "l1", endId: "a", at: 1_000 };
    expect(pickLineJumpEnd({ ...base, fraction: 0.1, now: 1_000 + LINE_JUMP_REPEAT_MS + 1, last })).toBe("a");
    expect(pickLineJumpEnd({ ...base, linkId: "l2", fraction: 0.1, now: 2_000, last })).toBe("a");
  });

  it("measures the click position along a path", () => {
    const straight = {
      getTotalLength: () => 100,
      getPointAtLength: (length: number) => ({ x: length, y: 0 }),
    };
    expect(nearestFractionOnPath(straight, { x: 30, y: 5 })).toBeCloseTo(0.3, 2);
    expect(nearestFractionOnPath(straight, { x: 90, y: -5 })).toBeCloseTo(0.9, 2);
  });
});

describe("node links do not widen a node", () => {
  it("measures a Markdown link by its label", () => {
    expect(displayedLineText("see [Some note](hive://note/abcdef1234567890) now")).toBe("see Some note now");
    expect(displayedLineText(String.raw`[a \[b\]](hive://point/1,2)`)).toBe("a [b]");
    expect(displayedLineText("plain text")).toBe("plain text");
  });
});

describe("tap A selects", () => {
  const order = ["n1", "n2", "n3", "n4"];
  const zoneOf = (id: string) => (id === "n1" || id === "n3" ? "z1" : null);
  const members = (zoneId: string) => (zoneId === "z1" ? ["n3", "n1"] : []);

  it("the members of the hovered zone in board order", () => {
    expect(nodesForSelectTap("z1", order, members, zoneOf)).toEqual(["n1", "n3"]);
  });

  it("every node outside zones when no zone is hovered", () => {
    expect(nodesForSelectTap(null, order, members, zoneOf)).toEqual(["n2", "n4"]);
  });
});

describe("title spellcheck menu", () => {
  it("offers spelling and clipboard items only", () => {
    const entries = buildNoteEditorContextMenu({
      hasSelection: false,
      plain: true,
      spellContext: { from: 0, to: 3, word: "teh", languages: ["en"] },
      suggestions: ["the"],
    });
    const ids = entries.flatMap((entry) => ("id" in entry ? [entry.id] : []));
    expect(ids).toContain("spellcheck.replace");
    expect(ids).toContain("spellcheck.addToDictionary");
    expect(ids).toContain("paste");
    expect(entries.some((entry) => "kind" in entry)).toBe(false);
  });
});
