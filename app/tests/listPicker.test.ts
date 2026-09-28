import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { listPickerInput } from "../src/list/pickerInput";
import { blurPointerFocusTarget } from "../src/ui/focusGuard";
import { addListTarget, addListText } from "../src/list/actions.svelte";
import { board, replaceBoard } from "../src/model/board.svelte";
import { clear, history, undo } from "../src/history/history.svelte";

class PickerElement extends EventTarget {
  constructor(readonly kind: "picker" | "input" | "button" | "outside", readonly ownerDocument: { defaultView: EventTarget }, readonly children: PickerElement[] = []) { super(); }
  contains(node: unknown): boolean { return node === this || this.children.includes(node as PickerElement); }
  closest(selector: string): PickerElement | null {
    return selector.includes(this.kind) ? this : null;
  }
  matches(): boolean { return false; }
  blur(): void { /* Browser blur is represented by the subsequent focusout below. */ }
}
function event(type: string, properties: Record<string, unknown>): Event {
  const value = new Event(type, { cancelable: true });
  for (const [key, property] of Object.entries(properties)) Object.defineProperty(value, key, { value: property });
  return value;
}
beforeEach(() => {
  vi.stubGlobal("Node", PickerElement); vi.stubGlobal("Element", PickerElement);
  clear(); replaceBoard([
    { id: "list", type: "list", name: "List", text: "", x: 0, y: 0, width: 30, height: null },
    { id: "node", type: "note", name: "Node", text: "", x: 0, y: 0, width: 30, height: null },
  ]);
});
afterEach(() => { vi.unstubAllGlobals(); clear(); replaceBoard([]); });

describe("List picker focus guard regression", () => {
  function picker() {
    const view = new EventTarget(), document = { defaultView: view };
    const input = new PickerElement("input", document), button = new PickerElement("button", document);
    const outside = new PickerElement("outside", document);
    const root = new PickerElement("picker", document, [input, button]);
    const close = vi.fn();
    const action = listPickerInput(root as unknown as HTMLElement, close)!;
    return { root, input, button, outside, view, close, action };
  }
  it("prevents native button focus transfer, preserving the search input through mouse activation", () => {
    const { root, button, close, action } = picker();
    const down = event("pointerdown", { target: button, button: 0 });
    root.dispatchEvent(down);
    expect(down.defaultPrevented).toBe(true);
    expect(close).not.toHaveBeenCalled();
    expect(addListTarget("list", "node")).toBe(true);
    expect(board.notes.list.listItems?.[0].targetId).toBe("node");
    expect(history.entries).toHaveLength(1);
    action.destroy?.();
  });
  it("does not unmount a result before its click when the global guard emits a null focusout", () => {
    const { root, button, close, action } = picker();
    expect(blurPointerFocusTarget(button as unknown as Element)).toBe(true);
    root.dispatchEvent(event("focusout", { target: button, relatedTarget: null }));
    expect(close).not.toHaveBeenCalled();
    expect(addListTarget("list", "node")).toBe(true);
    undo(); expect(board.notes.list.listItems).toEqual([]);
    action.destroy?.();
  });
  it("allows native input focus and text selection so typed text can be added", () => {
    const { root, input, close, action } = picker();
    const down = event("pointerdown", { target: input, button: 0 });
    root.dispatchEvent(down);
    expect(down.defaultPrevented).toBe(false);
    expect(blurPointerFocusTarget(input as unknown as Element)).toBe(false);
    expect(addListText("list", "A typed idea")).toBe(true);
    expect(board.notes.list.listItems?.[0]).toMatchObject({ targetId: null, label: "A typed idea" });
    expect(close).not.toHaveBeenCalled();
    action.destroy?.();
  });
  it("closes for keyboard focus outside and window blur, but keeps internal focus changes", () => {
    const { root, input, outside, view, close, action } = picker();
    root.dispatchEvent(event("focusout", { relatedTarget: input }));
    expect(close).not.toHaveBeenCalled();
    root.dispatchEvent(event("focusout", { relatedTarget: outside }));
    expect(close).toHaveBeenCalledTimes(1);
    view.dispatchEvent(new Event("blur")); expect(close).toHaveBeenCalledTimes(2);
    action.destroy?.();
    view.dispatchEvent(new Event("blur")); expect(close).toHaveBeenCalledTimes(2);
  });
});
