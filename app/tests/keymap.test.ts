import { describe, expect, it } from "vitest";
import {
  bindingFromEvent,
  editKeyBinding,
  filterKnownKeyOverrides,
  findBindingConflicts,
  isValidUserBinding,
  sanitizeKeyOverrides,
  type KeymapCommand,
} from "../src/commands/keymap";

const keymapCommands: KeymapCommand[] = [
  { id: "alpha", label: "Alpha", defaultKeys: ["KeyA"], keys: ["KeyA"] },
  { id: "beta", label: "Beta", defaultKeys: ["KeyB"], keys: ["KeyB"] },
  { id: "gamma", label: "Gamma", defaultKeys: [], keys: [] },
];

describe("user key bindings", () => {
  it("captures keyboard codes in the registry modifier order", () => {
    expect(bindingFromEvent({
      code: "KeyZ",
      ctrlKey: true,
      shiftKey: true,
      altKey: true,
      metaKey: false,
    })).toBe("Ctrl+Shift+Alt+KeyZ");
  });

  it("rejects Tab, modifier-only keys, and Meta combinations", () => {
    expect(isValidUserBinding("Tab")).toBe(false);
    expect(isValidUserBinding("Shift+Tab")).toBe(false);
    expect(isValidUserBinding("ControlLeft")).toBe(false);
    expect(bindingFromEvent({ code: "ShiftLeft", ctrlKey: false, shiftKey: true, altKey: false, metaKey: false })).toBeNull();
    expect(bindingFromEvent({ code: "KeyK", ctrlKey: false, shiftKey: false, altKey: false, metaKey: true })).toBeNull();
  });

  it("detects conflicts and leaves the keymap unchanged until replacement is confirmed", () => {
    const conflicts = findBindingConflicts(keymapCommands, "alpha", 0, "KeyB");
    expect(conflicts).toEqual([{ commandId: "beta", label: "Beta", bindingIndex: 0 }]);

    const cancelled = editKeyBinding(keymapCommands, {}, "alpha", 0, "KeyB");
    expect(cancelled.conflicts).toEqual(conflicts);
    expect(cancelled.overrides).toBeNull();
  });

  it("moves a conflicting binding to the new command when replacement is confirmed", () => {
    const result = editKeyBinding(keymapCommands, {}, "alpha", 0, "KeyB", true);
    expect(result.overrides).toEqual({ alpha: ["KeyB"], beta: [] });
  });

  it("sanitizes persisted overrides and safely filters unknown command ids", () => {
    const parsed = sanitizeKeyOverrides({
      "view.home": ["Ctrl+KeyH", "Tab", "Shift+Tab", "ControlLeft"],
      "empty.command": [],
      "bad id": ["KeyQ"],
      "partial.command": [23, "Alt+KeyP"],
    });

    expect(parsed).toEqual({ "view.home": ["Ctrl+KeyH"], "empty.command": [], "partial.command": ["Alt+KeyP"] });
    expect(filterKnownKeyOverrides(parsed, ["view.home", "partial.command"])).toEqual({
      "view.home": ["Ctrl+KeyH"],
      "partial.command": ["Alt+KeyP"],
    });
  });

  it("allows only one copy of a binding within a command", () => {
    const duplicate: KeymapCommand = {
      id: "duplicate",
      label: "Duplicate",
      defaultKeys: ["KeyA", "KeyB"],
      keys: ["KeyA", "KeyB"],
    };
    const result = editKeyBinding([duplicate], {}, "duplicate", 1, "KeyA", true);
    expect(result.overrides).toEqual({ duplicate: ["KeyA"] });
  });
});
