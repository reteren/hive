import { afterEach, describe, expect, it, vi } from "vitest";
import {
  commands,
  getCommand,
  getCommandKeyOverrides,
  registerCommand,
  resetAllCommandKeyOverrides,
  resetCommandKeyOverride,
  runCommand,
  setCommandKeyOverrides,
} from "../src/commands/registry.svelte";

afterEach(() => {
  commands.clear();
  setCommandKeyOverrides({});
});

describe("command registry", () => {
  it("keeps default and effective bindings on each registered command", () => {
    const command = { id: "test.run", label: "Run", keys: ["KeyR"], run: vi.fn() };

    registerCommand(command);

    expect(getCommand("test.run")).toMatchObject({ ...command, keys: ["KeyR"], defaultKeys: ["KeyR"] });
    expect(commands.get("test.run")).toBe(getCommand("test.run"));
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
    expect(() => registerCommand({ id: "test.shiftTab", label: "Reverse tab", keys: ["Shift+Tab"], run: vi.fn() })).toThrow(
      "Tab is reserved",
    );
  });

  it("applies known overrides, ignores unknown command ids, and restores factory defaults", () => {
    registerCommand({ id: "test.run", label: "Run", keys: ["KeyR"], run: vi.fn() });

    setCommandKeyOverrides({ "test.run": ["Ctrl+KeyR"], "removed.command": ["KeyQ"] });
    expect(getCommand("test.run")?.keys).toEqual(["Ctrl+KeyR"]);
    expect(getCommand("test.run")?.defaultKeys).toEqual(["KeyR"]);
    expect(getCommandKeyOverrides()).toEqual({ "test.run": ["Ctrl+KeyR"] });

    resetCommandKeyOverride("test.run");
    expect(getCommand("test.run")?.keys).toEqual(["KeyR"]);
    setCommandKeyOverrides({ "test.run": [] });
    expect(getCommand("test.run")?.keys).toEqual([]);
    resetAllCommandKeyOverrides();
    expect(getCommand("test.run")?.keys).toEqual(["KeyR"]);
  });
});
