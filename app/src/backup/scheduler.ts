export interface BackupFingerprintStatus {
  fingerprint: string;
  lastSnapshotFingerprint: string | null;
}

/** Periodic attempts are enabled only for a supported interval and changed project contents. */
export function shouldCreateScheduledBackup(
  interval: number,
  status: BackupFingerprintStatus,
): boolean {
  return (interval === 15 || interval === 30 || interval === 60) &&
    status.lastSnapshotFingerprint !== status.fingerprint;
}
