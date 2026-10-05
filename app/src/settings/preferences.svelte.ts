import { applyReduceMotionPreference, systemPrefersReducedMotion } from "./motion";
import {
  DEFAULT_VIDEO_EXTERNAL_THRESHOLD_MB,
  normalizeVideoExternalThresholdMb,
  type VideoExternalThresholdMb,
} from "./videoThreshold";

export const preferences = $state({
  reduceAnimations: systemPrefersReducedMotion(),
  transferHintsShown: 0,
  fitWidthToText: true,
  recordInBackground: false,
  videoExternalThresholdMb: DEFAULT_VIDEO_EXTERNAL_THRESHOLD_MB as VideoExternalThresholdMb,
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

export function setVideoExternalThresholdMb(value: unknown): void {
  preferences.videoExternalThresholdMb = normalizeVideoExternalThresholdMb(value);
}

applyReduceMotionPreference(preferences.reduceAnimations);
