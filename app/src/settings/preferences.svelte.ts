import { applyReduceMotionPreference, systemPrefersReducedMotion } from "./motion";

export const preferences = $state({
  reduceAnimations: systemPrefersReducedMotion(),
  transferHintsShown: 0,
  fitWidthToText: true,
  recordInBackground: false,
});

export function setTransferHintsShown(count: number): void {
  preferences.transferHintsShown = Math.max(0, Math.min(5, Math.trunc(count)));
}

export function recordTransferHintShown(): void {
  setTransferHintsShown(preferences.transferHintsShown + 1);
}

export function setReduceAnimations(enabled: boolean): void {
  preferences.reduceAnimations = enabled;
  applyReduceMotionPreference(enabled);
}

export function setFitWidthToText(enabled: boolean): void {
  preferences.fitWidthToText = enabled;
}

export function setRecordInBackground(enabled: boolean): void {
  preferences.recordInBackground = enabled;
}

applyReduceMotionPreference(preferences.reduceAnimations);
