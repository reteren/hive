export interface StorageStats {
  projectBytes: number;
  snapshotCount: number;
  snapshotBytes: number;
}

export const exportState = $state({
  busy: false,
  message: "",
  error: "",
  storageStats: null as StorageStats | null,
  storageError: "",
  refreshingStorage: false,
});

export function dismissExportNotice(): void {
  exportState.message = "";
  exportState.error = "";
}
