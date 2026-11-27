import { beforeEach, describe, expect, it } from "vitest";
import { clear, execute, history } from "../src/history/history.svelte";
import { dispatchMcpRequest, toMcpErrorPayload } from "../src/mcp/dispatcher";
import { McpError, registerMcpMethod } from "../src/mcp/registry";
import { replaceBoard } from "../src/model/board.svelte";
import { replaceLinks } from "../src/model/links.svelte";
import { replaceZones } from "../src/model/zones.svelte";
import { replaceArchive, replaceTrash } from "../src/model/retention.svelte";
import type { Note } from "../src/model/note";

beforeEach(() => clear());

describe("MCP dispatcher", () => {
  it("reports unsupported methods and includes registered method names", async () => {
    const name = "tests.available";
    registerMcpMethod({ name, mutating: false, run: () => true });

    await expect(dispatchMcpRequest({ method: "tests.missing", params: {} })).rejects.toMatchObject({
      code: "unsupported",
      message: expect.stringContaining(name),
    });
  });

  it("preserves McpError codes and maps unexpected exceptions to internal", () => {
    expect(toMcpErrorPayload(new McpError("not_found", "Node not found.", { id: "n1" }))).toEqual({
      code: "not_found",
      message: "Node not found.",
      data: { id: "n1" },
    });
    expect(toMcpErrorPayload(new Error("private detail"))).toMatchObject({
      code: "internal",
      message: expect.stringContaining("Check the hive log"),
    });
  });

  it("aborts a mutating operation after a method error", async () => {
    let value = 0;
    const name = "tests.failingMutation";
    registerMcpMethod({
      name,
      mutating: true,
      label: () => "write then fail",
      run: () => {
        execute({ label: "Set value", do: () => { value = 1; }, undo: () => { value = 0; } });
        throw new McpError("invalid_params", "The input was rejected.");
      },
    });

    await expect(dispatchMcpRequest({ method: name, params: {} })).rejects.toMatchObject({ code: "invalid_params" });
    expect(value).toBe(0);
    expect(history.entries).toHaveLength(0);
  });
});

describe("MCP dispatcher short ids", () => {
  const A = "3f2a9c1e-6b7d-4e8f-9a0b-1c2d3e4f5a6b";
  const B = "c4a37248-bdd7-418c-a36e-bcee6d831da1";
  const HEX = "abc12345-0000-4000-8000-000000000000";
  const TWIN_1 = "aaaaaaaa-1111-4111-8111-111111111111";
  const TWIN_2 = "aaaaaaaa-2222-4222-8222-222222222222";
  const node = (id: string): Note => ({ id, type: "note", name: `Node ${id.slice(0, 4)}`, text: "", x: 0, y: 0, width: 30, height: null });
  let counter = 0;
  const register = (run: (params: Record<string, unknown>) => unknown, mutating = false): string => {
    const name = `tests.shortIds${counter += 1}`;
    registerMcpMethod({ name, mutating, label: () => "test", run });
    return name;
  };

  beforeEach(() => {
    replaceBoard([node(A), node(B), node(HEX)]);
    replaceLinks([{ id: TWIN_1, from: A, to: B, kind: "strong", shape: "base" }]);
    replaceZones([]);
    replaceTrash([]);
    replaceArchive([]);
  });

  it("results carry short ids", async () => {
    const name = register(() => ({ id: A, links: [TWIN_1] }));
    await expect(dispatchMcpRequest({ method: name, params: {} })).resolves.toEqual({ id: "3f2a9c1e", links: ["aaaaaaaa"] });
  });

  it("full and short ids both resolve", async () => {
    let seen: unknown;
    const name = register((params) => { seen = params.ids; return true; });
    await dispatchMcpRequest({ method: name, params: { ids: [A, "c4a37248"] } });
    expect(seen).toEqual([A, B]);
  });

  it("refs are not expanded", async () => {
    let seen: unknown;
    const name = register((params) => { seen = params; return true; });
    await dispatchMcpRequest({ method: name, params: { nodes: [{ ref: "abc123", near: { node: "abc123" } }], links: [{ from: "abc123", to: "3f2a9c1e" }] } });
    expect(seen).toEqual({ nodes: [{ ref: "abc123", near: { node: "abc123" } }], links: [{ from: "abc123", to: A }] });
  });

  it("deleted ids are shortened", async () => {
    const name = register(() => { replaceBoard([node(B), node(HEX)]); return { deleted: [A] }; }, true);
    await expect(dispatchMcpRequest({ method: name, params: {} })).resolves.toEqual({ deleted: ["3f2a9c1e"] });
  });

  it("error data is shortened", async () => {
    const name = register(() => { throw new McpError("not_found", "Missing.", { id: A }); });
    await expect(dispatchMcpRequest({ method: name, params: {} })).rejects.toMatchObject({ code: "not_found", data: { id: "3f2a9c1e" } });
  });

  it("ambiguous input rejects before running", async () => {
    replaceLinks([
      { id: TWIN_1, from: A, to: B, kind: "strong", shape: "base" },
      { id: TWIN_2, from: B, to: A, kind: "strong", shape: "base" },
    ]);
    let ran = false;
    const name = register(() => { ran = true; return true; }, true);
    await expect(dispatchMcpRequest({ method: name, params: { ids: ["aaaaaaaa"] } })).rejects.toMatchObject({ code: "invalid_params" });
    expect(ran).toBe(false);
  });
});
