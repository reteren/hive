/** A small, shared cache of resolution-matched image decodes used by attachment previews. */
const MAX_CACHED_PIXELS = 32_000_000;
const MAX_CACHED_ENTRIES = 512;
/**
 * One small decode per picture, kept apart from the budgeted cache (zooming in fills that budget with
 * large decodes and evicts everything else). A picture that appears again shows its preview at once
 * while the sharp decode is made, instead of blinking empty. 2000 × 160² px ≈ 200 MB worst case.
 */
const PREVIEW_EDGE = 160;
const MAX_PREVIEWS = 2000;
const previews = new Map<string, ImageBitmap>();
const previewsInFlight = new Set<string>();

interface BitmapEntry {
  key: string;
  promise: Promise<ImageBitmap>;
  bitmap?: ImageBitmap;
  refs: number;
  pixels: number;
}

export interface DisplayBitmapLease {
  bitmap: ImageBitmap;
  release(): void;
}

const entries = new Map<string, BitmapEntry>();
let cachedPixels = 0;

/** Choose a thumbnail no larger than twice the displayed pixel size, preserving source aspect. */
export function displayBitmapSize(
  sourceWidth: number,
  sourceHeight: number,
  boxWidth: number,
  boxHeight: number,
  scale: number,
): { width: number; height: number } {
  const width = positive(sourceWidth);
  const height = positive(sourceHeight);
  const displayedWidth = positive(boxWidth) * positive(scale) * 2;
  const displayedHeight = positive(boxHeight) * positive(scale) * 2;
  if (!width || !height || !displayedWidth || !displayedHeight) return { width: 0, height: 0 };

  const exact = Math.min(1, displayedWidth / width, displayedHeight / height);
  // Snap the scale down to steps of √2 (still ≥1.4× the screen pixels). Steps of a fixed pixel size
  // changed on almost every zoom tick, so every picture on screen was decoded and redrawn again
  // while the wheel turned; now a picture is re-decoded only when the zoom changes by ~40%.
  const factor = exact >= 1 ? 1 : Math.SQRT2 ** Math.floor(Math.log2(exact) * 2);
  const targetWidth = Math.max(1, Math.floor(width * factor));
  const targetHeight = Math.max(1, Math.floor(height * factor));
  return { width: targetWidth, height: targetHeight };
}

// The encoded file bytes, kept per URL so a decode at another size (every zoom step that crosses a
// size step, every eviction) does not read the file again. Each read goes through the app's asset
// protocol, which is served on the window's main thread: re-reading on every decode meant ~1600
// file reads in 40 s of zooming a picture-heavy board, and wheel input queued up behind them.
const MAX_ENCODED_BYTES = 192 * 1024 * 1024;
const encoded = new Map<string, Promise<Blob>>();
const encodedSizes = new Map<string, number>();
let encodedBytes = 0;

function fetchEncoded(url: string): Promise<Blob> {
  const cached = encoded.get(url);
  if (cached) {
    encoded.delete(url);
    encoded.set(url, cached);
    return cached;
  }
  const request = fetch(url).then(async (response) => {
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const blob = await response.blob();
    if (encoded.get(url) === request) {
      encodedSizes.set(url, blob.size);
      encodedBytes += blob.size;
      trimEncoded();
    }
    return blob;
  });
  request.catch(() => {
    if (encoded.get(url) === request) encoded.delete(url);
  });
  encoded.set(url, request);
  return request;
}

function trimEncoded(): void {
  for (const url of encoded.keys()) {
    if (encodedBytes <= MAX_ENCODED_BYTES) break;
    const size = encodedSizes.get(url);
    if (size === undefined) continue; // still loading
    encoded.delete(url);
    encodedSizes.delete(url);
    encodedBytes -= size;
  }
}

/** Acquire a downscaled decoded copy; released entries are evicted by pixel-budget LRU. */
export function acquireDisplayBitmap(
  url: string,
  width: number,
  height: number,
): Promise<DisplayBitmapLease> {
  if (!url || width <= 0 || height <= 0) return Promise.reject(new Error("Image has no display size."));
  const key = `${url}\u0000${width}x${height}`;
  let entry = entries.get(key);
  if (entry) {
    entries.delete(key);
    entries.set(key, entry);
  } else {
    const created: BitmapEntry = {
      key,
      refs: 0,
      pixels: 0,
      promise: fetchEncoded(url).then(async (blob) => {
        const bitmap = await createImageBitmap(blob, {
          resizeWidth: width,
          resizeHeight: height,
          resizeQuality: "high",
        });
        created.bitmap = bitmap;
        created.pixels = bitmap.width * bitmap.height;
        rememberPreview(url, bitmap);
        cachedPixels += created.pixels;
        trimCache();
        return bitmap;
      }).catch((error: unknown) => {
        if (entries.get(key) === created) entries.delete(key);
        throw error;
      }),
    };
    entry = created;
    entries.set(key, entry);
  }

  entry.refs += 1;
  const requested = entry;
  return requested.promise.then((bitmap) => {
    let released = false;
    return {
      bitmap,
      release() {
        if (released) return;
        released = true;
        requested.refs = Math.max(0, requested.refs - 1);
        trimCache();
      },
    };
  }, (error: unknown) => {
    requested.refs = Math.max(0, requested.refs - 1);
    throw error;
  });
}

/** Look up an already-decoded image without retaining it, moving its LRU position or starting work. */
export function peekCachedDisplayBitmap(
  url: string,
  width?: number,
  height?: number,
): ImageBitmap | undefined {
  return bestCachedEntry(url, width, height)?.bitmap;
}

/**
 * Like peekCachedDisplayBitmap, but retains the decode: the cache cannot close it until the lease is
 * released. For callers that keep drawing the bitmap later (cached tiles), where a borrowed one
 * could be evicted in between and vanish from the board.
 */
export function leaseCachedDisplayBitmap(url: string, width?: number, height?: number): DisplayBitmapLease | undefined {
  const entry = bestCachedEntry(url, width, height);
  const bitmap = entry?.bitmap;
  if (!entry || !bitmap) return undefined;
  entry.refs += 1;
  let released = false;
  return {
    bitmap,
    release() {
      if (released) return;
      released = true;
      entry.refs = Math.max(0, entry.refs - 1);
      trimCache();
    },
  };
}

function bestCachedEntry(url: string, width?: number, height?: number): BitmapEntry | undefined {
  const prefix = `${url}\u0000`;
  let best: BitmapEntry | undefined;
  let bestScore = Number.POSITIVE_INFINITY;
  const targetWidth = Number.isFinite(width) && (width ?? 0) > 0 ? width! : undefined;
  const targetHeight = Number.isFinite(height) && (height ?? 0) > 0 ? height! : undefined;
  for (const [key, entry] of entries) {
    const bitmap = entry.bitmap;
    if (!bitmap || !key.startsWith(prefix)) continue;
    const pixels = bitmap.width * bitmap.height;
    let score = pixels;
    if (targetWidth && targetHeight) {
      const sufficient = bitmap.width >= targetWidth && bitmap.height >= targetHeight;
      const sizeDelta = Math.abs(Math.log(bitmap.width / targetWidth)) + Math.abs(Math.log(bitmap.height / targetHeight));
      score = sufficient ? sizeDelta : 1000 + Math.abs(Math.log(pixels / (targetWidth * targetHeight)));
    }
    if (score < bestScore) {
      best = entry;
      bestScore = score;
    }
  }
  return best;
}

/** Any decode of this picture that can be drawn right now: the closest cached size, else its preview. */
export function peekAnyDisplayBitmap(url: string, width?: number, height?: number): ImageBitmap | undefined {
  return peekCachedDisplayBitmap(url, width, height) ?? previews.get(url);
}

function rememberPreview(url: string, bitmap: ImageBitmap): void {
  const existing = previews.get(url);
  if (existing) {
    previews.delete(url);
    previews.set(url, existing);
    return;
  }
  if (previewsInFlight.has(url) || typeof createImageBitmap !== "function") return;
  const factor = Math.min(1, PREVIEW_EDGE / Math.max(bitmap.width, bitmap.height, 1));
  previewsInFlight.add(url);
  void createImageBitmap(bitmap, {
    resizeWidth: Math.max(1, Math.round(bitmap.width * factor)),
    resizeHeight: Math.max(1, Math.round(bitmap.height * factor)),
    resizeQuality: "medium",
  }).then((preview) => {
    previews.set(url, preview);
    while (previews.size > MAX_PREVIEWS) {
      const [oldest, old] = previews.entries().next().value as [string, ImageBitmap];
      previews.delete(oldest);
      old.close();
    }
  }).catch(() => undefined).finally(() => previewsInFlight.delete(url));
}

function trimCache(): void {
  while (cachedPixels > MAX_CACHED_PIXELS || entries.size > MAX_CACHED_ENTRIES) {
    let evicted = false;
    for (const [key, entry] of entries) {
      if (entry.refs > 0 || !entry.bitmap) continue;
      entries.delete(key);
      cachedPixels -= entry.pixels;
      entry.bitmap.close();
      evicted = true;
      break;
    }
    if (!evicted) break;
  }
}

function positive(value: number): number {
  return Number.isFinite(value) && value > 0 ? value : 0;
}

/** A cached decode that the cache has since evicted is closed: it reports 0×0 and cannot be drawn. */
export function isClosedBitmap(source: CanvasImageSource): boolean {
  return typeof ImageBitmap !== "undefined" && source instanceof ImageBitmap && (source.width === 0 || source.height === 0);
}
