export type BackupPanelAction = "none" | "create" | "health";

export const backupPanelState = $state({
  open: false,
  pendingAction: "none" as BackupPanelAction,
  error: "",
  healthFindings: null as string[] | null,
});

export function openBackupsPanel(): void {
  backupPanelState.open = true;
  backupPanelState.error = "";
}

export function requestCreateBackup(): void {
  openBackupsPanel();
  backupPanelState.pendingAction = "create";
}

export function requestProjectHealthCheck(): void {
  openBackupsPanel();
  backupPanelState.pendingAction = "health";
}

export function closeBackupsPanel(): void {
  backupPanelState.open = false;
  backupPanelState.pendingAction = "none";
}
