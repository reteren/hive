const frameByFile = new Map<string, Promise<string | null>>();

/** The still shown for a linked video is captured exactly halfway through its duration. */
export function videoFrameSeekTime(duration: number): number {
  return Number.isFinite(duration) && duration > 0 ? duration / 2 : 0;
}

/** Capture one small JPEG frame per immutable attachment file for this app session. */
export function tierlistVideoFrame(file: string, url: string, duration?: number): Promise<string | null> {
  if (!url) return Promise.resolve(null);
  const cached = frameByFile.get(file);
  if (cached) return cached;
  const frame = captureFrame(url, duration);
  frameByFile.set(file, frame);
  return frame;
}

function captureFrame(url: string, expectedDuration?: number): Promise<string | null> {
  if (typeof document === "undefined") return Promise.resolve(null);
  return new Promise((resolve) => {
    const video = document.createElement("video");
    video.preload = "auto";
    video.muted = true;
    video.playsInline = true;
    let settled = false;
    let timer = 0;

    const finish = (image: string | null): void => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timer);
      video.pause();
      video.removeAttribute("src");
      video.load();
      resolve(image);
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
        finish(canvas.toDataURL("image/jpeg", 0.82));
      } catch {
        finish(null);
      }
    };

    video.onerror = () => finish(null);
    video.onloadedmetadata = () => {
      const duration = Number.isFinite(video.duration) && video.duration > 0 ? video.duration : expectedDuration ?? 0;
      const seekTo = videoFrameSeekTime(duration);
      if (seekTo <= 0) {
        video.onloadeddata = draw;
        return;
      }
      video.onseeked = draw;
      try {
        video.currentTime = seekTo;
      } catch {
        finish(null);
      }
    };
    timer = window.setTimeout(() => finish(null), 15_000);
    video.src = url;
    video.load();
  });
}
