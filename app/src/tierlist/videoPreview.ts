const frameByFile = new Map<string, Promise<HTMLCanvasElement | null>>();
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
export function tierlistVideoFrame(file: string, url: string): Promise<HTMLCanvasElement | null> {
  if (!url) return Promise.resolve(null);
  const cached = frameByFile.get(file);
  if (cached) return cached;
  const frame = captureFrame(url);
  frameByFile.set(file, frame);
  return frame;
}

function captureFrame(url: string): Promise<HTMLCanvasElement | null> {
  if (typeof document === "undefined") return Promise.resolve(null);
  return new Promise((resolve) => {
    const video = document.createElement("video");
    video.preload = "auto";
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
