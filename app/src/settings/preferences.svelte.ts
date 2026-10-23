import { applyReduceMotionPreference, systemPrefersReducedMotion } from "./motion";
import {
  DEFAULT_VIDEO_EXTERNAL_THRESHOLD_MB,
  normalizeVideoExternalThresholdMb,
  type VideoExternalThresholdMb,
} from "./videoThreshold";
import { DEFAULT_SIMPLIFY_ZOOM_PERCENT, normalizeSimplifyZoomPercent } from "./simplifyZoom";
import { setSimplifyZoom } from "../board/visibility.svelte";
import { DEFAULT_RECORDING_FORMAT, normalizeRecordingFormat, type RecordingFormat } from "../audio/recordingFormat";

export const preferences = $state({
  reduceAnimations: systemPrefersReducedMotion(),
  transferHintsShown: 0,
  fitWidthToText: true,
  recordInBackground: false,
  recordingFormat: DEFAULT_RECORDING_FORMAT as RecordingFormat,
  allowAiToolsMcp: true,
  videoExternalThresholdMb: DEFAULT_VIDEO_EXTERNAL_THRESHOLD_MB as VideoExternalThresholdMb,
  simplifyZoomPercent: DEFAULT_SIMPLIFY_ZOOM_PERCENT,
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

export function setRecordingFormat(value: unknown): void {
  preferences.recordingFormat = normalizeRecordingFormat(value, preferences.recordingFormat);
}

export function setAllowAiToolsMcp(enabled: boolean): void {
  preferences.allowAiToolsMcp = enabled;
}

export function setVideoExternalThresholdMb(value: unknown): void {
  preferences.videoExternalThresholdMb = normalizeVideoExternalThresholdMb(value);
}

export function setSimplifyZoomPercent(value: unknown): void {
  preferences.simplifyZoomPercent = normalizeSimplifyZoomPercent(value, preferences.simplifyZoomPercent);
  setSimplifyZoom(preferences.simplifyZoomPercent / 100);
}

applyReduceMotionPreference(preferences.reduceAnimations);
