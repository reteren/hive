import { invoke, isTauri } from "@tauri-apps/api/core";
import { getCommands, registerCommand } from "../commands/registry.svelte";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { flushBeforeAppQuit, markQuitRequested } from "../lifecycle/closeFlush";
import { clearRecentProjects } from "../ui/menubar/recentProjects.svelte";
import type { RecentProject } from "../ui/menubar/menuModel";
import { chooseProject, closeProjectMenu, flushPendingSave, openProjectAt } from "./persistence.svelte";
import { project } from "./project.svelte";

let recentTarget: RecentProject | null = null;

export function setOpenRecentProject(target: RecentProject): void {
  recentTarget = target;
}

registerCommand({
  id: "project.new",
  label: "New Project",
  keys: ["Ctrl+Shift+KeyN"],
  run: () => {
    closeProjectMenu();
    void chooseProject("new");
  },
});

const saveKeys = getCommands().some((command) => command.keys.includes("Ctrl+KeyS")) ? [] : ["Ctrl+KeyS"];

registerCommand({
  id: "project.save",
  label: "Save Project",
  keys: saveKeys,
  run: () => {
    void flushPendingSave().catch((error: unknown) => {
      project.error = error instanceof Error ? error.message : String(error);
    });
  },
});

registerCommand({
  id: "project.openRecent",
  label: "Open Recent Project",
  keys: [],
  run: () => {
    const target = recentTarget;
    recentTarget = null;
    if (target) void openRecentProject(target);
  },
});

registerCommand({
  id: "project.clearRecent",
  label: "Clear Recent Projects",
  keys: [],
  run: () => {
    void clearRecentProjects().catch((error: unknown) => {
      project.error = error instanceof Error ? error.message : String(error);
    });
  },
});

registerCommand({
  id: "app.quit",
  label: "Quit Hive",
  keys: [],
  run: () => void quitHive(),
});

async function openRecentProject(target: RecentProject): Promise<void> {
  if (!isTauri()) return;
  project.error = "";
  try {
    if (target.kind === "zip") {
      const { importProjectFromZip } = await import("../export/actions");
      await importProjectFromZip(target.path);
      return;
    }
    await flushPendingSave();
    await openProjectAt(target.path);
  } catch (error) {
    project.error = error instanceof Error ? error.message : String(error);
  }
}

async function quitHive(): Promise<void> {
  if (!isTauri()) {
    project.error = "Quit is available in the desktop app.";
    return;
  }
  try {
    await flushBeforeAppQuit();
    await invoke("app_quit");
  } catch (error) {
    // Keep Quit usable while the Rust command is being registered by task F.
    console.warn("The app_quit command failed; using the existing close path.", error);
    try {
      await invoke("set_quit_requested", { requested: true });
      markQuitRequested(true);
      await getCurrentWindow().close();
    } catch (fallbackError) {
      markQuitRequested(false);
      project.error = fallbackError instanceof Error ? fallbackError.message : String(fallbackError);
    }
  }
}

registerCommand({
  id: "project.open",
  label: "Open Project",
  keys: ["Ctrl+KeyO"],
  run: () => {
    closeProjectMenu();
    void chooseProject("open");
  },
});
