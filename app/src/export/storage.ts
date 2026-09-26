const SIZE_UNITS = ["B", "KiB", "MiB", "GiB", "TiB"] as const;

/** Format bytes with binary units and at most one decimal place. */
export function formatStorageSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";

  let value = bytes;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < SIZE_UNITS.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }
  const formatted = new Intl.NumberFormat("en-US", { maximumFractionDigits: 1 }).format(value);
  return `${formatted} ${SIZE_UNITS[unitIndex]}`;
}

/** Approximate the in-project JSON storage occupied by a value. */
export function estimateJsonSize(value: unknown): number {
  const serialized = JSON.stringify(value);
  return serialized === undefined ? 0 : new TextEncoder().encode(serialized).byteLength;
}
