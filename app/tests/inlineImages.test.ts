import { markdown } from "@codemirror/lang-markdown";
import { EditorState } from "@codemirror/state";
import type { EditorView } from "@codemirror/view";
import { describe, expect, it, vi } from "vitest";
import type { ImageRef } from "../src/attachments/types";
import { commitInlineImageResize, insertImportedImages } from "../src/editor/inlineImages";
import {
  formatInlineImageToken,
  hiveMarkdownExtensions,
  hiveMarkdownParser,
  inlineImageTextForFit,
  parseInlineImageToken,
  prepareMarkdownPreview,
} from "../src/editor/markdownSyntax";
import { createMarkdownFragment } from "../src/editor/markdown";
import { searchNotes } from "../src/search/matching";
import { spellcheckExcludedRanges } from "../src/spell/spellcheck";

const file = `${"a".repeat(64)}.png`;

class FakeNode {
  readonly children: FakeNode[] = [];
  className = "";

  constructor(readonly tagName: string, private readonly value = "") {}

  appendChild(child: FakeNode): FakeNode {
    this.children.push(child);
    return child;
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

describe("inline image tokens", () => {
  it("parses the token as a Markdown image element and applies default and clamped widths", () => {
    const defaultToken = `![Photo](att:${file})`;
    const smallToken = `![Photo](att:${file}){w=2}`;
    const largeToken = `![Photo](att:${file}){w=999}`;
    const images: Array<{ from: number; to: number }> = [];
    hiveMarkdownParser.parse(defaultToken).iterate({
      enter(node) {
        if (node.name === "Image") images.push({ from: node.from, to: node.to });
      },
    });

    expect(images).toEqual([{ from: 0, to: defaultToken.length }]);
    expect(parseInlineImageToken(defaultToken)).toMatchObject({ alt: "Photo", file, widthPercent: 50, hasWidth: false });
    expect(parseInlineImageToken(smallToken)?.widthPercent).toBe(5);
    expect(parseInlineImageToken(largeToken)?.widthPercent).toBe(100);
  });

  it("does not parse or replace tokens inside code spans", () => {
    const token = `![code](att:${file}){w=65}`;
    const source = `\`${token}\` and ${token}`;
    const parsed: Array<{ from: number; to: number }> = [];
    hiveMarkdownParser.parse(source).iterate({
      enter(node) {
        if (node.name === "Image") parsed.push({ from: node.from, to: node.to });
      },
    });
    const prepared = prepareMarkdownPreview(source);
    const rendered = createMarkdownFragment(prepared.text, fakeDocument) as unknown as FakeNode;
    const markerLabel = collect(rendered).find((node) => node.className === "md-image-label");

    expect(parsed).toEqual([{ from: source.lastIndexOf(token), to: source.length }]);
    expect(prepared.inlineImages).toHaveLength(1);
    expect(prepared.text).toContain(`\`${token}\``);
    expect(prepared.text.match(/\]\(att:/gu)).toHaveLength(1);
    expect(prepared.text).toContain(`![${prepared.inlineImages[0].marker}](`);
    expect(markerLabel?.textContent).toBe(prepared.inlineImages[0].marker);
  });

  it("keeps attachment hashes out of text fit and search while retaining the alt text", () => {
    const token = formatInlineImageToken("Café photo", file, 50);
    const text = `See ${token} in this note`;
    const notes = [{ id: "note-1", name: "Note", text }];

    expect(inlineImageTextForFit(text)).toBe("See Café photo in this note");
    expect(searchNotes("Café photo", notes).some((result) => result.kind === "text")).toBe(true);
    expect(searchNotes("aaaaaaaaaa", notes)).toHaveLength(0);
  });

  it("excludes the complete token from spellcheck", () => {
    const token = formatInlineImageToken("Photo", file, 72);
    const state = EditorState.create({
      doc: `before ${token} after`,
      extensions: [markdown({ extensions: hiveMarkdownExtensions })],
    });
    const line = state.doc.line(1);

    expect(spellcheckExcludedRanges(state, line)).toContainEqual({
      from: "before ".length,
      to: "before ".length + token.length,
    });
  });

  it("commits a resize as one text change and inserts pasted images on their own line", () => {
    const raw = `![Photo](att:${file})`;
    const token = parseInlineImageToken(raw)!;
    const dispatch = vi.fn();
    const historyBoundary = vi.fn();
    const resizeView = {
      state: { sliceDoc: () => raw },
      dispatch,
    } as unknown as EditorView;

    commitInlineImageResize(resizeView, 0, raw.length, raw, token, 64, historyBoundary);

    expect(dispatch).toHaveBeenCalledTimes(1);
    expect(dispatch.mock.calls[0][0].changes).toEqual({
      from: 0,
      to: raw.length,
      insert: `![Photo](att:${file}){w=64}`,
    });
    expect(historyBoundary).toHaveBeenCalledTimes(2);

    const source = "before after";
    const doc = {
      length: source.length,
      lineAt: () => ({ from: 0, to: source.length }),
    };
    const pasteDispatch = vi.fn();
    const pasteBoundary = vi.fn();
    const pasteView = {
      state: {
        doc,
        selection: { main: { from: 7, to: 7 } },
        sliceDoc: (from: number, to: number) => source.slice(from, to),
      },
      dispatch: pasteDispatch,
    } as unknown as EditorView;
    const image: ImageRef = {
      file,
      mime: "image/png",
      size: 128,
      name: "photo.png",
      naturalWidth: 16,
      naturalHeight: 9,
    };

    insertImportedImages(pasteView, [image], undefined, pasteBoundary);

    expect(pasteDispatch).toHaveBeenCalledTimes(1);
    expect(pasteDispatch.mock.calls[0][0].changes.insert).toBe(
      `\n![photo.png](att:${file}){w=50}\n`,
    );
    expect(pasteBoundary).toHaveBeenCalledTimes(2);
  });
});
