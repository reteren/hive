export const TIERLIST_FRAME_CACHE_ENTRIES = 32;
export const TIERLIST_FRAME_CACHE_PIXELS = 6_000_000;
interface FrameEntry {
  promise: Promise<HTMLCanvasElement | null>;
  canvas?: HTMLCanvasElement;
  settled: boolean;
  refs: number;
}
const frameByFile = new Map<string, FrameEntry>();
export const TIERLIST_VIDEO_FRAME_TIMEOUT_MS = 15_000;
export const TIERLIST_VIDEO_FRAME_FALLBACK_TIME = 0.1;

/** The still shown for a linked video is captured exactly halfway through its duration. */
export function videoFrameSeekTime(duration: number): number {
  return Number.isFinite(duration) ? Math.max(0, duration) / 2 : 1;
}

export function videoFrameTimeoutFallbackTime(): number {
  return TIERLIST_VIDEO_FRAME_FALLBACK_TIME;
}

/** Capture and retain one small canvas per immutable attachment file for this app session. */
export interface TierlistVideoFrameLease {
  promise: Promise<HTMLCanvasElement | null>;
  release(): void;
}

export function tierlistVideoFrame(file: string, url: string): TierlistVideoFrameLease {
  if (!url) return { promise: Promise.resolve(null), release() {} };
  let entry = frameByFile.get(file);
  if (entry) {
    frameByFile.delete(file);
    frameByFile.set(file, entry);
  } else {
    entry = { promise: Promise.resolve(null), settled: false, refs: 0 };
    const created = entry;
    created.promise = captureFrame(url).then((canvas) => {
      created.canvas = canvas ?? undefined;
      created.settled = true;
      trimTierlistFrameCache(frameByFile);
      return canvas;
    });
    frameByFile.set(file, created);
  }
  entry.refs += 1;
  let released = false;
  return {
    promise: entry.promise,
    release() {
      if (released) return;
      released = true;
      entry!.refs = Math.max(0, entry!.refs - 1);
      trimTierlistFrameCache(frameByFile);
    },
  };
}

/** Evict least-recently-used resolved frames and release their canvas backing stores. */
export function trimTierlistFrameCache(
  entries: Map<string, FrameEntry>,
  maxEntries = TIERLIST_FRAME_CACHE_ENTRIES,
  maxPixels = TIERLIST_FRAME_CACHE_PIXELS,
): void {
  const pixels = (): number => [...entries.values()].reduce((total, entry) => total + (entry.canvas?.width ?? 0) * (entry.canvas?.height ?? 0), 0);
  while (entries.size > maxEntries || pixels() > maxPixels) {
    let removed = false;
    for (const [key, entry] of entries) {
      if (!entry.settled || entry.refs > 0) continue;
      entries.delete(key);
      if (entry.canvas) {
        entry.canvas.width = 0;
        entry.canvas.height = 0;
      }
      removed = true;
      break;
    }
    if (!removed) break;
  }
}

function captureFrame(url: string): Promise<HTMLCanvasElement | null> {
  if (typeof document === "undefined") return Promise.resolve(null);
  return new Promise((resolve) => {
    const video = document.createElement("video");
    video.preload = "metadata";
    video.muted = true;
    video.playsInline = true;
    let settled = false;
    let timeoutTimer = 0;
    let fallbackTimer = 0;
    let fallbackRequested = false;
    let fallbackSeekStarted = false;

    const finish = (canvas: HTMLCanvasElement | null): void => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timeoutTimer);
      window.clearTimeout(fallbackTimer);
      video.pause();
      video.removeAttribute("src");
      video.load();
      resolve(canvas);
    };

    const draw = (): void => {
      if (video.videoWidth <= 0 || video.videoHeight <= 0) {
        finish(null);
        return;
      }
      const maxSide = 480;
      const scale = Math.min(1, maxSide / Math.max(video.videoWidth, video.videoHeight));
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.round(video.videoWidth * scale));
      canvas.height = Math.max(1, Math.round(video.videoHeight * scale));
      const context = canvas.getContext("2d");
      if (!context) {
        finish(null);
        return;
      }
      try {
        context.drawImage(video, 0, 0, canvas.width, canvas.height);
        finish(canvas);
      } catch {
        finish(null);
      }
    };

    const requestFirstFrame = (): void => {
      if (settled || fallbackSeekStarted) return;
      fallbackRequested = true;
      fallbackSeekStarted = true;
      video.onseeked = draw;
      try {
        video.currentTime = videoFrameTimeoutFallbackTime();
      } catch {
        fallbackSeekStarted = false;
        if (video.videoWidth > 0) draw();
      }
      if (!settled) {
        fallbackTimer = window.setTimeout(() => {
          if (video.videoWidth > 0) draw();
          else finish(null);
        }, 3_000);
      }
    };

    video.onerror = () => finish(null);
    video.onloadedmetadata = () => {
      if (fallbackRequested) {
        requestFirstFrame();
        return;
      }
      const seekTo = videoFrameSeekTime(video.duration);
      if (seekTo <= 0) {
        video.onloadeddata = draw;
        return;
      }
      video.onseeked = draw;
      try {
        video.currentTime = seekTo;
      } catch {
        requestFirstFrame();
      }
    };
    timeoutTimer = window.setTimeout(requestFirstFrame, TIERLIST_VIDEO_FRAME_TIMEOUT_MS);
    video.src = url;
    video.load();
  });
}
