export type BackupInterval = 0 | 15 | 30 | 60;

export const BACKUP_INTERVAL_OPTIONS: readonly BackupInterval[] = [0, 15, 30, 60];

export const backupSettings = $state({ interval: 30 as BackupInterval });

export function setBackupInterval(value: BackupInterval): void {
  if (!BACKUP_INTERVAL_OPTIONS.includes(value)) return;
  backupSettings.interval = value;
}

export function parseBackupInterval(value: unknown, fallback: BackupInterval = 30): BackupInterval {
  return BACKUP_INTERVAL_OPTIONS.includes(value as BackupInterval) ? value as BackupInterval : fallback;
}
