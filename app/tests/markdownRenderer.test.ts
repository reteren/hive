import { describe, expect, it } from "vitest";
import { createMarkdownFragment, linkedNoteIds } from "../src/editor/markdown";

class FakeNode {
  readonly children: FakeNode[] = [];
  readonly attributes = new Map<string, string>();
  readonly listeners = new Map<string, EventListener>();
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

  addEventListener(type: string, listener: EventListener): void {
    this.listeners.set(type, listener);
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

  it("renders supported links as safe, clickable spans without href attributes", () => {
    const tree = render("[safe label](https://example.test)");
    const all = collect(tree);
    expect(all.some((node) => node.tagName === "a")).toBe(false);
    const link = all.find((node) => node.attributes.get("data-text-link") === "");
    expect(link?.attributes.get("role")).toBe("link");
    expect(link?.attributes.get("href")).toBeUndefined();
    expect(tree.textContent).toBe("safe label");
  });

  it("assigns distinct static preview classes to note, point and external links", () => {
    const tree = render(
      "[note](hive://note/id) [point](hive://point/1,2) [web](https://example.test)",
    );
    const links = collect(tree).filter((node) => node.className.includes("md-link-text"));

    expect(links.map((node) => node.className)).toEqual([
      "md-link-text is-note-link is-clickable is-missing",
      "md-link-text is-point-link is-clickable",
      "md-link-text is-external-link is-clickable",
    ]);
  });

  it("resolves note names, point addresses and visibly marks missing notes", () => {
    const notices: string[] = [];
    const noteJumps: string[] = [];
    const tree = createMarkdownFragment(
      "[note](hive://note/id-1) [ ](hive://point/-2.5,3) [gone](hive://note/deleted)",
      fakeDocument,
      {
        resolveNote: (noteId) => noteId === "id-1" ? { id: noteId, name: "Current name" } : undefined,
        teleportToNote: (noteId) => { noteJumps.push(noteId); return true; },
        onNotice: (message) => notices.push(message),
      },
    ) as unknown as FakeNode;
    const links = collect(tree).filter((node) => node.attributes.get("role") === "link");

    expect(links.map((link) => link.textContent)).toEqual(["note", "Point (-2.5, 3)", "gone (missing)"]);
    expect(links[2].className).toContain("is-missing");
    links[0].listeners.get("click")?.({ preventDefault() {}, stopPropagation() {} } as Event);
    expect(noteJumps).toEqual(["id-1"]);
    links[2].listeners.get("click")?.({ preventDefault() {}, stopPropagation() {} } as Event);
    expect(notices).toEqual(["This note is missing."]);

    const noLabelTree = createMarkdownFragment("[ ](hive://note/id-1)", fakeDocument, {
      resolveNote: (noteId) => noteId === "id-1" ? { id: noteId, name: "Current name" } : undefined,
    }) as unknown as FakeNode;
    expect(collect(noLabelTree).find((node) => node.attributes.get("role") === "link")?.textContent)
      .toBe("Current name");
  });

  it("invokes link actions and keeps unsupported schemes inert", () => {
    const opened: string[] = [];
    const teleported: Array<{ x: number; y: number }> = [];
    const tree = createMarkdownFragment(
      "[web](https://example.test/path) [point](hive://point/1.25,-4) [unsafe](javascript:alert(1))",
      fakeDocument,
      {
        openExternal: (url) => { opened.push(url); },
        teleportToPoint: (point) => { teleported.push(point); },
      },
    ) as unknown as FakeNode;
    const links = collect(tree);
    const clickable = links.filter((node) => node.attributes.get("role") === "link");
    const unsafe = links.find((node) => node.textContent === "unsafe");

    clickable[0].listeners.get("click")?.({ preventDefault() {}, stopPropagation() {} } as Event);
    clickable[1].listeners.get("click")?.({ preventDefault() {}, stopPropagation() {} } as Event);
    expect(opened).toEqual(["https://example.test/path"]);
    expect(teleported).toEqual([{ x: 1.25, y: -4 }]);
    expect(unsafe?.attributes.has("role")).toBe(false);
    expect(unsafe?.attributes.has("href")).toBe(false);
  });

  it("renders plain hive addresses as clickable links in pasted note text", () => {
    const tree = createMarkdownFragment("Point hive://point/-2.5,3 and note hive://note/note-1.", fakeDocument, {
      resolveNote: (noteId) => noteId === "note-1" ? { id: noteId, name: "Renamed note" } : undefined,
    }) as unknown as FakeNode;
    const links = collect(tree).filter((node) => node.attributes.get("role") === "link");

    expect(links.map((link) => link.textContent)).toEqual(["Point (-2.5, 3)", "Renamed note"]);
    expect(linkedNoteIds("See hive://note/note-1.")).toEqual(["note-1"]);

    const codeTree = render("`hive://point/1,2`");
    expect(collect(codeTree).some((node) => node.attributes.has("data-text-link"))).toBe(false);
  });
});
