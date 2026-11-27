import { describe, expect, it } from "vitest";
import { allowsNativeContextMenu, isBrowserShortcut } from "../src/ui/browserDefaultsGuard";

function key(code: string, modifiers: { ctrl?: boolean; shift?: boolean; alt?: boolean; meta?: boolean } = {}) {
  return {
    code,
    ctrlKey: modifiers.ctrl ?? false,
    shiftKey: modifiers.shift ?? false,
    altKey: modifiers.alt ?? false,
    metaKey: modifiers.meta ?? false,
  };
}

interface FakeElement {
  tagName: string;
  type?: string;
  isContentEditable?: boolean;
  parentElement: FakeElement | null;
}

function element(tagName: string, parent: FakeElement | null = null, extra: Partial<FakeElement> = {}): FakeElement {
  return { tagName, parentElement: parent, ...extra };
}

describe("browser shortcuts hive never hands to WebView2", () => {
  it.each([
    ["Ctrl+F find bar", key("KeyF", { ctrl: true })],
    ["Ctrl+G find next", key("KeyG", { ctrl: true })],
    ["Ctrl+Shift+G find previous", key("KeyG", { ctrl: true, shift: true })],
    ["F3 find next", key("F3")],
    ["Shift+F3 find previous", key("F3", { shift: true })],
    ["Ctrl+P print", key("KeyP", { ctrl: true })],
    ["Ctrl+R reload", key("KeyR", { ctrl: true })],
    ["Ctrl+Shift+R hard reload", key("KeyR", { ctrl: true, shift: true })],
    ["F5 reload", key("F5")],
    ["Ctrl+F5 hard reload", key("F5", { ctrl: true })],
    ["Ctrl+S save page as", key("KeyS", { ctrl: true })],
    ["Ctrl+U view source", key("KeyU", { ctrl: true })],
    ["Meta counts as Ctrl", key("KeyF", { meta: true })],
  ])("%s", (_label, event) => {
    expect(isBrowserShortcut(event)).toBe(true);
  });

  it.each([
    ["plain F typed in a note", key("KeyF")],
    ["Shift+F capital letter", key("KeyF", { shift: true })],
    ["Ctrl+C copy", key("KeyC", { ctrl: true })],
    ["Ctrl+V paste", key("KeyV", { ctrl: true })],
    ["Ctrl+Z undo", key("KeyZ", { ctrl: true })],
    ["Ctrl+A select all", key("KeyA", { ctrl: true })],
    ["Ctrl+Alt+F (AltGr layouts type characters with it)", key("KeyF", { ctrl: true, alt: true })],
    ["Alt+F3", key("F3", { alt: true })],
    ["F2", key("F2")],
  ])("leaves %s alone", (_label, event) => {
    expect(isBrowserShortcut(event)).toBe(false);
  });
});

describe("where the native WebView2 context menu may still open", () => {
  it("allows it in text inputs and text areas (Cut / Copy / Paste)", () => {
    expect(allowsNativeContextMenu(element("INPUT", null, { type: "text" }))).toBe(true);
    expect(allowsNativeContextMenu(element("INPUT", null, { type: "search" }))).toBe(true);
    expect(allowsNativeContextMenu(element("INPUT"))).toBe(true);
    expect(allowsNativeContextMenu(element("TEXTAREA"))).toBe(true);
  });

  it("allows it inside contenteditable content", () => {
    const editable = element("DIV", null, { isContentEditable: true });
    expect(allowsNativeContextMenu(element("SPAN", editable, { isContentEditable: true }))).toBe(true);
  });

  it("blocks the page menu (Back / Refresh / Save as / Print) everywhere else", () => {
    const board = element("DIV");
    expect(allowsNativeContextMenu(board)).toBe(false);
    expect(allowsNativeContextMenu(element("CANVAS", board))).toBe(false);
    expect(allowsNativeContextMenu(element("svg", board))).toBe(false);
    expect(allowsNativeContextMenu(element("BUTTON", board))).toBe(false);
    expect(allowsNativeContextMenu(element("INPUT", board, { type: "checkbox" }))).toBe(false);
    expect(allowsNativeContextMenu(element("INPUT", board, { type: "range" }))).toBe(false);
    expect(allowsNativeContextMenu(null)).toBe(false);
  });
});
