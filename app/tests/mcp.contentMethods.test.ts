import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../src/attachments/service", () => ({
  attachmentUrl: (file: string) => `asset://${file}`,
}));

vi.mock("../src/formats/formatLoad", () => ({
  loadFormatText: vi.fn(async () => ({ text: "abcdef", encoding: "utf-8", byteLength: 6 })),
}));

vi.mock("../src/mcp/content/imagePayload", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/mcp/content/imagePayload")>();
  return {
    ...actual,
    attachmentImagePayload: vi.fn(async (image: { file: string; mime: string }) => ({
      file: image.file,
      mime: "image/jpeg" as const,
      data: "AQID",
      width: 2,
      height: 1,
      originalWidth: 4,
      originalHeight: 2,
      ...(image.mime === "image/gif" ? { animated: true as const } : {}),
    })),
  };
});

import "../src/mcp/contentMethods";
import { getMcpMethod } from "../src/mcp/registry";
import { replaceBoard, board } from "../src/model/board.svelte";
import type { Note, NoteKind } from "../src/model/note";
import { setCalculatorData } from "../src/calculator/calculators.svelte";
import { project } from "../src/project/project.svelte";

function note(id: string, type: NoteKind, patch: Partial<Note> = {}): Note {
  return { id, type, name: `${type}-${id}`, text: "", x: 10, y: 20, width: 30, height: null, ...patch };
}

async function content(id: string, params: Record<string, unknown> = {}): Promise<Record<string, any>> {
  const method = getMcpMethod("nodes.content");
  if (!method) throw new Error("nodes.content was not registered.");
  return await method.run({ id, ...params }) as Record<string, any>;
}

beforeEach(() => {
  replaceBoard([]);
  project.path = "C:/projects/sample";
  project.ready = true;
});

describe("nodes.content", () => {
  it("returns note text, inline images, deduped web and YouTube links, and stored data read-only", async () => {
    const current = note("n1", "note", {
      text: "See [video](https://youtu.be/dQw4w9WgXcQ?si=x) and https://example.test/page. ![cat](att:cat.png)",
      task: { done: false, doneAt: null },
    });
    replaceBoard([current]);
    const orderBefore = board.order.slice();

    const result = await content("n1");

    expect(result).toMatchObject({
      id: "n1",
      type: "note",
      text: current.text,
      data: { task: { done: false, doneAt: null } },
      inlineImages: [{ file: "cat.png" }],
      links: [
        { url: "https://youtu.be/dQw4w9WgXcQ?si=x", kind: "youtube", videoId: "dQw4w9WgXcQ" },
        { url: "https://example.test/page", kind: "web" },
      ],
    });
    expect(board.order).toEqual(orderBefore);
  });

  it("tolerates optional stored fields that are explicitly undefined", async () => {
    replaceBoard([note("n2", "note", { importance: undefined, glow: undefined })]);

    const result = await content("n2");

    expect(result.data).toHaveProperty("importance", undefined);
    expect(result.data).toHaveProperty("glow", undefined);
  });

  it("returns a converted image and marks GIF output as the first frame", async () => {
    replaceBoard([note("i1", "image", {
      image: { file: "loop.gif", mime: "image/gif", size: 100, naturalWidth: 400, naturalHeight: 200 },
      opacity: 0.5,
      flipX: true,
    })]);

    const result = await content("i1");

    expect(result).toMatchObject({
      image: { file: "loop.gif", animated: true },
      opacity: 0.5,
      flipX: true,
    });
  });

  it("loads and truncates format content while preserving the mapped language", async () => {
    replaceBoard([note("f1", "format", {
      media: { file: "code.ts", name: "code.ts", mime: "text/plain", size: 6, kind: "text" },
    })]);

    const result = await content("f1", { maxTextChars: 3 });

    expect(result).toMatchObject({
      file: { name: "code.ts", mime: "text/plain", size: 6 },
      content: "abc",
      language: "typescript",
      truncated: true,
    });
  });

  it("returns source metadata and reads a project image", async () => {
    replaceBoard([note("s1", "source", {
      source: { url: "https://music.youtube.com/watch?v=dQw4w9WgXcQ", filePath: null, file: "cover.webp", description: "Album" },
    })]);

    const result = await content("s1");

    expect(result).toMatchObject({
      source: { url: "https://music.youtube.com/watch?v=dQw4w9WgXcQ", file: "cover.webp", description: "Album" },
      image: { file: "cover.webp" },
      links: [{ kind: "youtube", videoId: "dQw4w9WgXcQ" }],
    });
  });

  it("returns tier image payloads and calculator entries from stored project data", async () => {
    replaceBoard([
      note("t1", "tierlist", {
        tiers: [{ id: "row", name: "Top", color: "#ffffff", cards: [{ id: "card", kind: "image", image: { file: "card.png", mime: "image/png", size: 20, naturalWidth: 10, naturalHeight: 10 } }] }],
      }),
      note("c1", "calculator", { name: "Budget" }),
    ]);
    setCalculatorData("Budget", { entries: [{ id: "e1", expression: "12 * 3" }], bank: null, rows: [] });

    const tierlist = await content("t1");
    const calculator = await content("c1");

    expect(tierlist.tierImages).toMatchObject([{ file: "card.png" }]);
    expect(calculator.data.calculator.entries).toEqual([{ id: "e1", expression: "12 * 3" }]);
  });

  it("rejects invalid options and missing nodes with MCP errors", async () => {
    replaceBoard([]);
    await expect(content("missing")).rejects.toMatchObject({ code: "not_found" });
    await expect(content("missing", { maxImagePx: 64 })).rejects.toMatchObject({ code: "invalid_params" });
  });
});
