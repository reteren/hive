export const DEFAULT_VIDEO_EXTERNAL_THRESHOLD_MB = 20;
export const VIDEO_EXTERNAL_THRESHOLD_BYTES_PER_MB = 1024 * 1024;
export const MAX_VIDEO_EXTERNAL_THRESHOLD_MB = Math.floor(
  Number.MAX_SAFE_INTEGER / VIDEO_EXTERNAL_THRESHOLD_BYTES_PER_MB,
);
export const UNLIMITED_VIDEO_EXTERNAL_THRESHOLD_BYTES = 0;

export type VideoExternalThresholdMb = number | null;

/** Invalid saved values use the default; null means always copy videos into the project. */
export function normalizeVideoExternalThresholdMb(
  value: unknown,
  fallback: VideoExternalThresholdMb = DEFAULT_VIDEO_EXTERNAL_THRESHOLD_MB,
): VideoExternalThresholdMb {
  if (value === null) return null;
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 1 &&
    value <= MAX_VIDEO_EXTERNAL_THRESHOLD_MB
    ? value
    : fallback;
}

/** Zero is reserved for Unlimited; omitted Rust arguments retain the legacy 20 MB default. */
export function videoExternalThresholdBytes(value: VideoExternalThresholdMb): number {
  const threshold = normalizeVideoExternalThresholdMb(value);
  return threshold === null
    ? UNLIMITED_VIDEO_EXTERNAL_THRESHOLD_BYTES
    : threshold * VIDEO_EXTERNAL_THRESHOLD_BYTES_PER_MB;
}

export function videoExceedsExternalThreshold(sizeBytes: number, value: VideoExternalThresholdMb): boolean {
  const threshold = normalizeVideoExternalThresholdMb(value);
  return threshold !== null && sizeBytes > threshold * VIDEO_EXTERNAL_THRESHOLD_BYTES_PER_MB;
}
