import { invoke, isTauri } from "@tauri-apps/api/core";
import { open, save } from "@tauri-apps/plugin-dialog";
import { project } from "../project/project.svelte";
import { flushPendingSave, openProjectAt } from "../project/persistence.svelte";
import { exportState, type StorageStats } from "./exportState.svelte";

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
    exportState.error = "Project export is available in the desktop app.";
    exportState.message = "";
    return;
  }
  if (!project.path) {
    exportState.error = "Open a project before exporting it.";
    exportState.message = "";
    return;
  }

  exportState.busy = true;
  exportState.error = "";
  exportState.message = "Choose a location for the project export…";
  try {
    await flushPendingSave();
    const destination = await save({
      title: "Export Hive project",
      defaultPath: `${project.name || "Hive"}.zip`,
      filters: [{ name: "Hive project archive", extensions: ["zip"] }],
    });
    if (typeof destination !== "string" || destination.length === 0) {
      exportState.message = "";
      return;
    }
    const archivePath = destination.toLowerCase().endsWith(".zip") ? destination : `${destination}.zip`;

    exportState.message = "Exporting project…";
    const exportedPath = await invoke<string>("export_project", { destinationPath: archivePath });
    exportState.message = `Project exported to ${exportedPath}`;
  } catch (error) {
    setOperationError(error);
  } finally {
    exportState.busy = false;
  }
}

export async function importProjectFromZip(): Promise<void> {
  if (exportState.busy) return;
  if (!isTauri()) {
    exportState.error = "Project import is available in the desktop app.";
    exportState.message = "";
    return;
  }

  exportState.busy = true;
  exportState.error = "";
  exportState.message = "Choose a Hive project zip…";
  try {
    const archivePath = await open({
      title: "Choose a Hive project zip",
      multiple: false,
      filters: [{ name: "Hive project archive", extensions: ["zip"] }],
    });
    if (typeof archivePath !== "string" || archivePath.length === 0) {
      exportState.message = "";
      return;
    }
    exportState.message = "Choose an empty destination folder…";
    const destination = await open({
      title: "Choose an empty folder for the imported project",
      directory: true,
      multiple: false,
    });
    if (typeof destination !== "string" || destination.length === 0) {
      exportState.message = "";
      return;
    }

    await flushPendingSave();
    exportState.message = "Importing project…";
    const importedPath = await invoke<string>("import_project_zip", {
      zipPath: archivePath,
      destinationPath: destination,
    });
    await openProjectAt(importedPath);
    exportState.message = `Project imported from ${archivePath} to ${importedPath}`;
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
