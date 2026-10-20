import { invoke, isTauri } from "@tauri-apps/api/core";
import { open, save } from "@tauri-apps/plugin-dialog";
import { project } from "../project/project.svelte";
import { flushPendingSave, openProjectAt } from "../project/persistence.svelte";
import { exportState, type StorageStats } from "./exportState.svelte";
import { t } from "../i18n/i18n.svelte";

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function setOperationError(error: unknown): void {
  exportState.busy = false;
  exportState.error = errorMessage(error);
  exportState.message = "";
}

export async function exportCurrentProject(): Promise<void> {
  if (exportState.busy) return;
  if (!isTauri()) {
    exportState.error = t("Project export is available in the desktop app.");
    exportState.message = "";
    return;
  }
  if (!project.path) {
    exportState.error = t("Open a project before exporting it.");
    exportState.message = "";
    return;
  }

  exportState.busy = true;
  exportState.error = "";
  exportState.message = t("Choose a location for the project export…");
  try {
    await flushPendingSave();
    const destination = await save({
      title: t("Export Hive project"),
      defaultPath: `${project.name || "Hive"}.zip`,
      filters: [{ name: t("Hive project archive"), extensions: ["zip"] }],
    });
    if (typeof destination !== "string" || destination.length === 0) {
      exportState.message = "";
      return;
    }
    const archivePath = destination.toLowerCase().endsWith(".zip") ? destination : `${destination}.zip`;

    exportState.message = t("Exporting project…");
    const exportedPath = await invoke<string>("export_project", { destinationPath: archivePath });
    exportState.message = t("Project exported to {exportedPath}", { exportedPath: exportedPath });
  } catch (error) {
    setOperationError(error);
  } finally {
    exportState.busy = false;
  }
}

export async function importProjectFromZip(selectedArchivePath?: string): Promise<void> {
  if (exportState.busy) return;
  if (!isTauri()) {
    exportState.error = t("Project import is available in the desktop app.");
    exportState.message = "";
    return;
  }

  exportState.busy = true;
  exportState.error = "";
  exportState.message = t("Choose a Hive project zip…");
  try {
    const archivePath = selectedArchivePath ?? await open({
      title: t("Choose a Hive project zip"),
      multiple: false,
      filters: [{ name: t("Hive project archive"), extensions: ["zip"] }],
    });
    if (typeof archivePath !== "string" || archivePath.length === 0) {
      exportState.message = "";
      return;
    }
    exportState.message = t("Choose an empty destination folder…");
    const destination = await open({
      title: t("Choose an empty folder for the imported project"),
      directory: true,
      multiple: false,
    });
    if (typeof destination !== "string" || destination.length === 0) {
      exportState.message = "";
      return;
    }

    await flushPendingSave();
    exportState.message = t("Importing project…");
    const importedPath = await invoke<string>("import_project_zip", {
      zipPath: archivePath,
      destinationPath: destination,
    });
    await openProjectAt(importedPath);
    await invoke("recent_projects_add", { path: archivePath, kind: "zip" }).catch((error: unknown) => {
      console.warn("Could not add the imported zip to recent projects.", error);
    });
    exportState.message = t("Project imported from {archivePath} to {importedPath}", { archivePath: archivePath, importedPath: importedPath });
    await refreshStorageStats();
  } catch (error) {
    setOperationError(error);
  } finally {
    exportState.busy = false;
  }
}

export async function refreshStorageStats(): Promise<void> {
  if (!isTauri() || !project.path || exportState.refreshingStorage) return;
  exportState.refreshingStorage = true;
  exportState.storageError = "";
  try {
    exportState.storageStats = await invoke<StorageStats>("project_storage_stats");
  } catch (error) {
    exportState.storageError = errorMessage(error);
  } finally {
    exportState.refreshingStorage = false;
  }
}
