import { beforeEach, describe, expect, it } from "vitest";
import { clear, execute, history } from "../src/history/history.svelte";
import { dispatchMcpRequest, toMcpErrorPayload } from "../src/mcp/dispatcher";
import { McpError, registerMcpMethod } from "../src/mcp/registry";

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
