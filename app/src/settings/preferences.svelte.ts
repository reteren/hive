import { applyReduceMotionPreference, systemPrefersReducedMotion } from "./motion";

export const preferences = $state({
  reduceAnimations: systemPrefersReducedMotion(),
  transferHintsShown: 0,
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

applyReduceMotionPreference(preferences.reduceAnimations);
