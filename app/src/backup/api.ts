import { invoke, isTauri } from "@tauri-apps/api/core";
import { flushPendingSave, openProjectAt } from "../project/persistence.svelte";
import { project } from "../project/project.svelte";
import type { BackupFingerprintStatus } from "./scheduler";

export interface BackupInfo {
  id: string;
  date: string;
  sizeBytes: number;
  noteCount: number;
}

export interface BackupListing {
  backups: BackupInfo[];
  totalSizeBytes: number;
}

export interface HealthReport {
  findings: string[];
}

function requireDesktop(): void {
  if (!isTauri()) throw new Error("Backups are available in the desktop app.");
}

export async function listBackups(): Promise<BackupListing> {
  requireDesktop();
  return invoke<BackupListing>("list_backups");
}

/** Flush board edits before taking a user-visible or automatic snapshot. */
export async function createBackup(): Promise<BackupInfo> {
  requireDesktop();
  await flushPendingSave();
  return invoke<BackupInfo>("create_backup");
}

export async function backupStatus(): Promise<BackupFingerprintStatus> {
  requireDesktop();
  await flushPendingSave();
  return invoke<BackupFingerprintStatus>("backup_status");
}

export async function createBackupIfChanged(): Promise<BackupInfo | null> {
  requireDesktop();
  await flushPendingSave();
  return invoke<BackupInfo | null>("create_backup_if_changed");
}

export async function deleteBackup(id: string): Promise<void> {
  requireDesktop();
  await invoke("delete_backup", { id });
}

export async function restoreBackup(id: string): Promise<void> {
  requireDesktop();
  const path = project.path;
  if (!path) throw new Error("No project is open.");
  await flushPendingSave();
  await invoke("restore_backup", { id });
  await openProjectAt(path);
}

export async function checkProjectHealth(): Promise<HealthReport> {
  requireDesktop();
  await flushPendingSave();
  return invoke<HealthReport>("check_project_health");
}
