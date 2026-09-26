import { describe, expect, it, vi } from "vitest";
import { blurPointerFocusTarget, shouldBlurPointerFocus } from "../src/ui/focusGuard";

interface FakeTargetOptions {
  focusable?: boolean;
  focusableSelector?: string;
  editableSelector?: string;
  disabled?: boolean;
  hasBlur?: boolean;
}

function fakeTarget(options: FakeTargetOptions = {}): Element & { blur: ReturnType<typeof vi.fn> } {
  const target = {
    closest: vi.fn((selector: string) => {
      if (options.focusable && selector.includes(options.focusableSelector ?? "button")) return target;
      if (options.editableSelector && selector.includes(options.editableSelector)) return target;
      if (selector.includes(":disabled") && options.disabled) return target;
      return null;
    }),
    matches: vi.fn((selector: string) => selector.includes(":disabled") && Boolean(options.disabled)),
    blur: options.hasBlur === false ? undefined : vi.fn(),
  };
  return target as unknown as Element & { blur: ReturnType<typeof vi.fn> };
}

describe("pointer focus guard", () => {
  it.each([
    ["buttons", "button"],
    ["ARIA role buttons", "[role='button']"],
    ["zone resize handles", "[data-zone-resize-handle]"],
    ["note resize handles", "[data-resize-handle]"],
    ["group scale handles", "[data-group-scale-handle]"],
  ])("blurs pointer-focused %s", (_label, focusableSelector) => {
    const options = { focusable: true, focusableSelector };
    const target = fakeTarget(options);

    expect(shouldBlurPointerFocus(target)).toBe(true);
    expect(blurPointerFocusTarget(target)).toBe(true);
    expect(target.blur).toHaveBeenCalledOnce();
    expect(target.closest).toHaveBeenCalledWith(expect.stringContaining(focusableSelector));
  });

  it.each([
    ["inputs", "input"],
    ["scope selects", "select"],
    ["contenteditable editors", "[contenteditable]"],
    ["CodeMirror editors", ".cm-content"],
  ])("preserves focus on %s", (_label, editableSelector) => {
    const options = { focusable: true, editableSelector };
    const target = fakeTarget(options);

    expect(shouldBlurPointerFocus(target)).toBe(false);
    expect(blurPointerFocusTarget(target)).toBe(false);
    expect(target.blur).not.toHaveBeenCalled();
  });

  it("preserves an editor nested inside a focusable note surface", () => {
    const noteSurface = fakeTarget({ focusable: true });
    const editor = {
      closest: vi.fn((selector: string) => {
        if (selector.includes("[role='button']")) return noteSurface;
        if (selector.includes(".cm-content")) return editor;
        return null;
      }),
      matches: vi.fn(() => false),
      blur: vi.fn(),
    } as unknown as Element & { blur: ReturnType<typeof vi.fn> };

    expect(shouldBlurPointerFocus(editor)).toBe(false);
    expect(blurPointerFocusTarget(editor)).toBe(false);
    expect(noteSurface.blur).not.toHaveBeenCalled();
    expect(editor.blur).not.toHaveBeenCalled();
  });

  it("ignores non-focusable and disabled targets", () => {
    const plain = fakeTarget();
    const disabled = fakeTarget({ focusable: true, disabled: true });

    expect(shouldBlurPointerFocus(plain)).toBe(false);
    expect(blurPointerFocusTarget(plain)).toBe(false);
    expect(shouldBlurPointerFocus(disabled)).toBe(false);
    expect(disabled.blur).not.toHaveBeenCalled();
  });

  it("does not claim success when a focus target cannot be blurred", () => {
    const target = fakeTarget({ focusable: true, hasBlur: false });

    expect(blurPointerFocusTarget(target)).toBe(false);
  });
});
