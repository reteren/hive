import { isTauri } from "@tauri-apps/api/core";
import { project } from "../project/project.svelte";
import { backupSettings } from "./backupSettings.svelte";
import { backupStatus, createBackup, createBackupIfChanged } from "./api";
import { shouldCreateScheduledBackup } from "./scheduler";

let initialized = false;
let lastOpenedPath = "";
let checkQueue: Promise<void> = Promise.resolve();

export function initializeBackupScheduler(): void {
  if (initialized) return;
  initialized = true;
  $effect.root(() => {
    $effect(() => {
      const ready = project.ready;
      const path = project.path;
      if (!isTauri() || !ready || !path || path === lastOpenedPath) return;
      lastOpenedPath = path;
      void createBackup().catch((error: unknown) => {
        console.warn("Automatic project snapshot failed.", error);
      });
    });

    $effect(() => {
      const interval = backupSettings.interval;
      if (!isTauri() || interval === 0) return;
      const timer = window.setInterval(() => {
        checkQueue = checkQueue.catch(() => undefined).then(async () => {
          const status = await backupStatus();
          if (shouldCreateScheduledBackup(interval, status)) await createBackupIfChanged();
        }).catch((error: unknown) => {
          console.warn("Automatic project snapshot check failed.", error);
        });
      }, interval * 60_000);
      return () => window.clearInterval(timer);
    });
  });
}
