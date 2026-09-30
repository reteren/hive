import { expect, it } from "vitest";
import { dispatchImagePaste, registerImagePasteHandler } from "../src/attachments/pasteDispatch";

it("routes image paste to the highest-priority handler that accepts it", () => {
  const calls: string[] = [];
  const offBoard = registerImagePasteHandler(0, () => { calls.push("board"); return true; });
  const offTier = registerImagePasteHandler(30, () => { calls.push("tier"); return false; });
  const file = new File([new Uint8Array([1])], "a.png", { type: "image/png" });
  expect(dispatchImagePaste([file])).toBe(true);
  expect(calls).toEqual(["tier", "board"]);
  expect(dispatchImagePaste([])).toBe(false);
  offBoard(); offTier();
  expect(dispatchImagePaste([file])).toBe(false);
});
