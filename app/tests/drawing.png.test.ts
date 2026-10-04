import { describe, expect, it } from "vitest";
import { encodeRgbaPng } from "../src/drawing/png";

/** Independent bitwise CRC-32 (PNG chunk checksum) for verification. */
function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) crc = crc & 1 ? (crc >>> 1) ^ 0xedb88320 : crc >>> 1;
  }
  return (crc ^ 0xffffffff) >>> 0;
}

async function inflate(data: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([data.slice()]).stream().pipeThrough(new DecompressionStream("deflate"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

describe("drawing PNG encoder", () => {
  it("writes a valid RGBA PNG whose pixels round-trip", async () => {
    const pixels = new Uint8ClampedArray([
      255, 0, 0, 255, 0, 255, 0, 128,
      0, 0, 255, 0, 10, 20, 30, 40,
    ]);
    const bytes = new Uint8Array(await (await encodeRgbaPng(pixels, 2, 2)).arrayBuffer());
    expect([...bytes.subarray(0, 8)]).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

    const view = new DataView(bytes.buffer);
    const chunks = new Map<string, Uint8Array>();
    for (let offset = 8; offset < bytes.length;) {
      const length = view.getUint32(offset);
      const type = String.fromCharCode(...bytes.subarray(offset + 4, offset + 8));
      const data = bytes.subarray(offset + 8, offset + 8 + length);
      expect(view.getUint32(offset + 8 + length)).toBe(crc32(bytes.subarray(offset + 4, offset + 8 + length)));
      chunks.set(type, data);
      offset += 12 + length;
    }
    const header = new DataView(chunks.get("IHDR")!.buffer, chunks.get("IHDR")!.byteOffset);
    expect([header.getUint32(0), header.getUint32(4), chunks.get("IHDR")![8], chunks.get("IHDR")![9]]).toEqual([2, 2, 8, 6]);
    expect(chunks.has("IEND")).toBe(true);
    const raw = await inflate(chunks.get("IDAT")!);
    expect([...raw]).toEqual([0, ...pixels.subarray(0, 8), 0, ...pixels.subarray(8)]);
  });
});
