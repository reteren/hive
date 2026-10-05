import { invoke, isTauri } from "@tauri-apps/api/core";
import { normalizeRecentProjects, type RecentProject } from "./menuModel";

export const recentProjectsState = $state({ items: [] as RecentProject[] });

export async function refreshRecentProjects(): Promise<void> {
  if (!isTauri()) {
    recentProjectsState.items = [];
    return;
  }
  try {
    recentProjectsState.items = normalizeRecentProjects(
      await invoke<RecentProject[]>("recent_projects_list"),
    );
  } catch {
    // Keep the File menu usable during startup and in builds without the recent-project command.
    recentProjectsState.items = [];
  }
}

export async function clearRecentProjects(): Promise<void> {
  await invoke("recent_projects_clear");
  recentProjectsState.items = [];
}
