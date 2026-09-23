import { describe, expect, it } from "vitest";
import { createMarkdownFragment } from "../src/editor/markdown";

class FakeNode {
  readonly children: FakeNode[] = [];
  readonly attributes = new Map<string, string>();
  readonly style: { backgroundColor?: string; color?: string } = {};
  className = "";

  constructor(readonly tagName: string, private readonly value = "") {}

  appendChild(child: FakeNode): FakeNode {
    this.children.push(child);
    return child;
  }

  setAttribute(name: string, value: string): void {
    this.attributes.set(name, value);
  }

  get textContent(): string {
    return this.tagName === "#text" ? this.value : this.children.map((child) => child.textContent).join("");
  }
}

const fakeDocument = {
  createDocumentFragment: () => new FakeNode("#fragment"),
  createElement: (tag: string) => new FakeNode(tag),
  createTextNode: (text: string) => new FakeNode("#text", text),
} as unknown as Document;

function collect(node: FakeNode): FakeNode[] {
  return [node, ...node.children.flatMap(collect)];
}

function render(source: string): FakeNode {
  return createMarkdownFragment(source, fakeDocument) as unknown as FakeNode;
}

describe("static Markdown renderer", () => {
  it("renders headings, inline formatting, code, lists, task markers, quotes, rules, and GFM tables", () => {
    const tree = render(
      "# Heading\n\n**bold** *italic* ~~strike~~ `code`\n\n- [ ] open\n- [x] done\n\n> quoted\n\n---\n\n| A | B |\n| --- | --- |\n| X | Y |\n\n```js\nalert(1)\n```",
    );
    const all = collect(tree);
    const tags = all.map((node) => node.tagName);

    for (const tag of ["h1", "strong", "em", "s", "code", "ul", "li", "blockquote", "hr", "table", "thead", "tbody", "th", "td", "pre"]) {
      expect(tags).toContain(tag);
    }
    expect(all.filter((node) => node.attributes.get("role") === "checkbox")).toHaveLength(2);
    expect(all.some((node) => node.tagName === "a")).toBe(false);
    expect(all.some((node) => node.tagName === "script")).toBe(false);
  });

  it("renders colored highlight text with contrast and keeps the color suffix out of view", () => {
    const source = "==bright=={{#ffff00}} and ==dark=={{#122033}}";
    const tree = render(source);
    const marks = collect(tree).filter((node) => node.tagName === "mark");

    expect(marks.map((node) => [node.textContent, node.style.backgroundColor, node.style.color])).toEqual([
      ["bright", "#ffff00", "#000000"],
      ["dark", "#122033", "#ffffff"],
    ]);
    expect(tree.textContent).toBe("bright and dark");
  });

  it("keeps raw HTML as text and creates no elements from note content", () => {
    const source = '<img src=x onerror="alert(1)"><script>alert(2)</script>';
    const tree = render(source);
    const all = collect(tree);

    expect(tree.textContent).toContain("<img src=x");
    expect(tree.textContent).toContain("<script>");
    expect(all.some((node) => node.tagName === "img" || node.tagName === "script")).toBe(false);
    expect(all.some((node) => node.attributes.has("onerror"))).toBe(false);
  });

  it("shows link labels as styled text without navigation", () => {
    const tree = render("[safe label](https://example.test)");
    const all = collect(tree);
    expect(all.some((node) => node.tagName === "a")).toBe(false);
    expect(all.every((node) => !node.attributes.has("href"))).toBe(true);
    expect(tree.textContent).toBe("safe label");
  });
});
