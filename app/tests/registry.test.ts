import { afterEach, describe, expect, it, vi } from "vitest";
import { commands, getCommand, registerCommand, runCommand, type Command } from "../src/commands/registry.svelte";

afterEach(() => {
  commands.clear();
});

describe("command registry", () => {
  it("keeps the shared command shape and returns registered commands", () => {
    const command: Command = { id: "test.run", label: "Run", keys: ["KeyR"], run: vi.fn() };

    registerCommand(command);

    expect(getCommand("test.run")).toBe(command);
    expect(commands.get("test.run")).toBe(command);
  });

  it("runs a registered command by id and ignores unknown ids", () => {
    const run = vi.fn();
    registerCommand({ id: "test.run", label: "Run", keys: [], run });

    runCommand("test.run");
    runCommand("test.missing");

    expect(run).toHaveBeenCalledOnce();
  });

  it("rejects Tab-based bindings so they cannot disable focus traversal", () => {
    expect(() => registerCommand({ id: "test.tab", label: "Tab", keys: ["Tab"], run: vi.fn() })).toThrow(
      "Tab is reserved",
    );
    expect(() =>
      registerCommand({ id: "test.shiftTab", label: "Reverse tab", keys: ["Shift+Tab"], run: vi.fn() }),
    ).toThrow("Tab is reserved");
  });
});
