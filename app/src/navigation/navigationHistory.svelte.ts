import { NavigationHistory, type CameraSnapshot } from "./navigationHistory";

const stack = new NavigationHistory();

/** Revision used by the Objects panel to refresh its back/forward controls. */
export const navigationHistoryState = $state({ revision: 0 });

export function pushNavigation(before: CameraSnapshot, after: CameraSnapshot): void {
  stack.push(before, after);
  navigationHistoryState.revision += 1;
}

export function pointNavigationAt(snapshot: CameraSnapshot): void {
  if (stack.pointTo(snapshot)) navigationHistoryState.revision += 1;
}

export function navigateBack(): CameraSnapshot | undefined {
  const snapshot = stack.back();
  if (snapshot) navigationHistoryState.revision += 1;
  return snapshot;
}

export function navigateForward(): CameraSnapshot | undefined {
  const snapshot = stack.forward();
  if (snapshot) navigationHistoryState.revision += 1;
  return snapshot;
}

export function canNavigateBack(): boolean {
  navigationHistoryState.revision;
  return stack.canGoBack;
}

export function canNavigateForward(): boolean {
  navigationHistoryState.revision;
  return stack.canGoForward;
}

/** Clear teleport navigation when the caller intentionally starts a new session. */
export function clearNavigationHistory(): void {
  stack.clear();
  navigationHistoryState.revision += 1;
}
