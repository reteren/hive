/** Return the operating system's reduced-motion preference when the API exists. */
export function systemPrefersReducedMotion(): boolean {
  return typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/** Apply the preference to a document dataset, kept pure for unit tests. */
export function setReduceMotionDataset(dataset: { reduceMotion?: string }, enabled: boolean): void {
  if (enabled) dataset.reduceMotion = "true";
  else delete dataset.reduceMotion;
}

export function applyReduceMotionPreference(enabled: boolean): void {
  if (typeof document === "undefined") return;
  setReduceMotionDataset(document.documentElement.dataset, enabled);
}
