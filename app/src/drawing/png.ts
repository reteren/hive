/**
 * Minimal RGBA PNG encoder on the native zlib stream (CompressionStream "deflate").
 *
 * Why not canvas.toBlob / OffscreenCanvas.convertToBlob: Chromium (and WebView2) encode those in idle
 * time or with the next rendered frame, so right after a stroke — when nothing repaints — Undo entries
 * and tile saves waited until the user moved the mouse again. This encoder resolves immediately.
 */

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(bytes: Uint8Array, start: number, end: number): number {
  let crc = 0xffffffff;
  for (let index = start; index < end; index += 1) crc = CRC_TABLE[(crc ^ bytes[index]!) & 0xff]! ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + data.length);
  const view = new DataView(out.buffer);
  view.setUint32(0, data.length);
  for (let index = 0; index < 4; index += 1) out[4 + index] = type.charCodeAt(index);
  out.set(data, 8);
  view.setUint32(8 + data.length, crc32(out, 4, 8 + data.length));
  return out;
}

async function zlib(data: Uint8Array<ArrayBuffer>): Promise<Uint8Array> {
  const stream = new Blob([data]).stream().pipeThrough(new CompressionStream("deflate"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/** Encode straight-alpha RGBA pixels (as from getImageData) into a PNG blob. */
export async function encodeRgbaPng(pixels: Uint8ClampedArray, width: number, height: number): Promise<Blob> {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1 || pixels.length !== width * height * 4) {
    throw new RangeError("PNG pixels do not match their size.");
  }
  const rowBytes = width * 4;
  // Each scanline: filter byte 0 (None) + RGBA bytes.
  const raw = new Uint8Array(new ArrayBuffer((rowBytes + 1) * height));
  for (let row = 0; row < height; row += 1) {
    raw.set(pixels.subarray(row * rowBytes, (row + 1) * rowBytes), row * (rowBytes + 1) + 1);
  }
  const header = new Uint8Array(13);
  const view = new DataView(header.buffer);
  view.setUint32(0, width);
  view.setUint32(4, height);
  header[8] = 8; // bit depth
  header[9] = 6; // RGBA
  const signature = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const parts = [signature, chunk("IHDR", header), chunk("IDAT", await zlib(raw)), chunk("IEND", new Uint8Array())];
  return new Blob(parts as BlobPart[], { type: "image/png" });
}
