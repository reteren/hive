/** CodeMirror normalizes line separators internally; remember the file's preferred spelling. */
export interface FormatTextEncoding {
  bom: boolean;
  lineEnding: "\n" | "\r\n";
}

export const LARGE_FORMAT_HIGHLIGHT_LIMIT = 5 * 1024 * 1024;

export function shouldHighlightFormatText(byteLength: number): boolean {
  return byteLength <= LARGE_FORMAT_HIGHLIGHT_LIMIT;
}

export function decodeFormatText(bytes: Uint8Array): { text: string; encoding: FormatTextEncoding } {
  const bom = bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf;
  const content = new TextDecoder("utf-8", { fatal: true }).decode(bom ? bytes.subarray(3) : bytes);
  const crlfCount = (content.match(/\r\n/g) ?? []).length;
  const lfCount = (content.match(/\n/g) ?? []).length - crlfCount;
  return {
    text: content.replace(/\r\n?/g, "\n"),
    encoding: { bom, lineEnding: crlfCount > lfCount ? "\r\n" : "\n" },
  };
}

export function encodeFormatText(text: string, encoding: FormatTextEncoding): string {
  const normalized = text.replace(/\r\n?/g, "\n");
  const content = encoding.lineEnding === "\r\n" ? normalized.replace(/\n/g, "\r\n") : normalized;
  return encoding.bom ? `\ufeff${content}` : content;
}
