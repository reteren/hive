import { describe, expect, it } from "vitest";
import { createIdIndex, expandParamIds, shortenIds } from "../src/mcp/shortIds";
import { McpError } from "../src/mcp/registry";

const A = "3f2a9c1e-6b7d-4e8f-9a0b-1c2d3e4f5a6b";
const B = "c4a37248-bdd7-418c-a36e-bcee6d831da1";
const TWIN_1 = "aaaaaaaa-1111-4111-8111-111111111111";
const TWIN_2 = "aaaaaaaa-2222-4222-8222-222222222222";

describe("MCP short ids", () => {
  it("short form is 8 chars", () => {
    const index = createIdIndex([A, B]);
    expect(index.short(A)).toBe("3f2a9c1e");
    expect(index.short(B)).toBe("c4a37248");
  });

  it("colliding prefixes grow", () => {
    const index = createIdIndex([TWIN_1, TWIN_2, A]);
    expect(index.short(TWIN_1)).toBe("aaaaaaaa-1");
    expect(index.short(TWIN_2)).toBe("aaaaaaaa-2");
    expect(index.short(A)).toBe("3f2a9c1e");
  });

  it("short ids stay", () => {
    const index = createIdIndex(["me", "n1", A]);
    expect(index.short("me")).toBe("me");
    expect(index.short("n1")).toBe("n1");
    expect(index.short("not-in-index-but-long")).toBe("not-in-index-but-long");
  });

  it("resolve exact, prefix, unknown", () => {
    const index = createIdIndex([A, B, "n1"]);
    expect(index.resolve(A)).toBe(A);
    expect(index.resolve("3f2a9c1e")).toBe(A);
    expect(index.resolve("3F2A9C")).toBe(A);
    expect(index.resolve("n1")).toBe("n1");
    expect(index.resolve("zzzzzz")).toBe("zzzzzz");
    expect(index.resolve("3f2a9")).toBe("3f2a9");
  });

  it("ambiguous prefix throws", () => {
    const index = createIdIndex([TWIN_1, TWIN_2]);
    let error: unknown;
    try {
      index.resolve("aaaaaaaa");
    } catch (caught) {
      error = caught;
    }
    expect(error).toBeInstanceOf(McpError);
    expect((error as McpError).code).toBe("invalid_params");
    expect((error as McpError).message).toContain(TWIN_1);
    expect((error as McpError).message).toContain(TWIN_2);
    expect(index.resolve("aaaaaaaa-2")).toBe(TWIN_2);
  });

  it("shortenIds replaces exact matches only", () => {
    const index = createIdIndex([A, B]);
    const result = shortenIds({ id: A, links: [{ from: A, to: B }], text: `see ${A}`, count: 2, empty: null }, index);
    expect(result).toEqual({ id: "3f2a9c1e", links: [{ from: "3f2a9c1e", to: "c4a37248" }], text: `see ${A}`, count: 2, empty: null });
  });

  it("only id keys are expanded", () => {
    const index = createIdIndex([A, B]);
    const untouched = { query: "3f2a9c1e", name: "3f2a9c1e", textEdit: { find: "3f2a9c1e", replace: "x" } };
    expect(expandParamIds(untouched, index)).toEqual(untouched);
    expect(expandParamIds({
      ids: ["3f2a9c1e", B],
      updates: [{ id: "c4a37248", zoneId: "3f2a9c1e" }],
      near: { node: "c4a37248" },
      linkedTo: "3f2a9c1e",
      nodeId: "c4a37248",
      links: [{ from: "3f2a9c1e", to: "c4a37248" }],
    }, index)).toEqual({
      ids: [A, B],
      updates: [{ id: B, zoneId: A }],
      near: { node: B },
      linkedTo: A,
      nodeId: B,
      links: [{ from: A, to: B }],
    });
  });

  it("data subtree untouched", () => {
    const index = createIdIndex([A]);
    const params = { updates: [{ id: "3f2a9c1e", data: { listItems: [{ id: "3f2a9c1e" }] } }] };
    expect(expandParamIds(params, index)).toEqual({ updates: [{ id: A, data: { listItems: [{ id: "3f2a9c1e" }] } }] });
  });

  it("refs are not expanded", () => {
    const index = createIdIndex(["abc12345-0000-4000-8000-000000000000", A]);
    const params = { nodes: [{ ref: "abc123", near: { node: "abc123" } }], links: [{ from: "abc123", to: "3f2a9c1e" }] };
    expect(expandParamIds(params, index)).toEqual({
      nodes: [{ ref: "abc123", near: { node: "abc123" } }],
      links: [{ from: "abc123", to: A }],
    });
  });
});
