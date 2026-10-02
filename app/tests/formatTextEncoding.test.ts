import { describe, expect, it } from "vitest";
import { decodeFormatText, encodeFormatText, shouldHighlightFormatText } from "../src/formats/textEncoding";

describe("Format text encoding", () => {
  it("preserves a UTF-8 BOM and CRLF when edited text is saved", () => {
    const original = new TextEncoder().encode("\ufefffirst\r\nsecond\r\n");
    const decoded = decodeFormatText(original);
    expect(decoded).toEqual({ text: "first\nsecond\n", encoding: { bom: true, lineEnding: "\r\n" } });
    expect(new TextEncoder().encode(encodeFormatText(`${decoded.text}third\n`, decoded.encoding)))
      .toEqual(new TextEncoder().encode("\ufefffirst\r\nsecond\r\nthird\r\n"));
  });

  it("keeps LF and no BOM for ordinary UTF-8 files", () => {
    const decoded = decodeFormatText(new TextEncoder().encode("one\ntwo\n"));
    expect(encodeFormatText(`${decoded.text}three`, decoded.encoding)).toBe("one\ntwo\nthree");
  });

  it("rejects invalid UTF-8 instead of silently replacing bytes", () => {
    expect(() => decodeFormatText(new Uint8Array([0xff]))).toThrow();
  });

  it("disables syntax highlighting above 5 MB", () => {
    expect(shouldHighlightFormatText(5 * 1024 * 1024)).toBe(true);
    expect(shouldHighlightFormatText(5 * 1024 * 1024 + 1)).toBe(false);
  });
});
