import { applyReduceMotionPreference, systemPrefersReducedMotion } from "./motion";

export const preferences = $state({
  reduceAnimations: systemPrefersReducedMotion(),
});

export function setReduceAnimations(enabled: boolean): void {
  preferences.reduceAnimations = enabled;
  applyReduceMotionPreference(enabled);
}

applyReduceMotionPreference(preferences.reduceAnimations);
