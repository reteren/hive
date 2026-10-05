import { isTauri } from "@tauri-apps/api/core";
import { check, type Update } from "@tauri-apps/plugin-updater";
import { flushBeforeAppQuit } from "../lifecycle/closeFlush";

type UpdatePhase = "idle" | "available" | "downloading" | "installing" | "error";

/** Update offer shown once per launch when GitHub has a newer signed release. */
export const updater = $state({
  phase: "idle" as UpdatePhase,
  version: "",
  notes: "",
  progress: 0,
  error: "",
});

let pending: Update | null = null;
let started = false;

/** Check the release feed once after startup; failures (offline, no release yet) stay silent. */
export function startUpdateCheck(delayMs = 4_000): void {
  if (started || !isTauri()) return;
  started = true;
  window.setTimeout(() => void runCheck(), delayMs);
}

async function runCheck(): Promise<void> {
  try {
    const update = await check();
    if (!update) return;
    pending = update;
    updater.version = update.version;
    updater.notes = update.body?.trim() ?? "";
    updater.phase = "available";
  } catch (error) {
    console.warn("Update check failed.", error);
  }
}

/** Download, save the project, then let the installer replace and restart hive. */
export async function installUpdate(): Promise<void> {
  if (!pending || updater.phase === "downloading" || updater.phase === "installing") return;
  updater.phase = "downloading";
  updater.progress = 0;
  updater.error = "";
  let total = 0;
  let received = 0;
  try {
    await pending.download((event) => {
      if (event.event === "Started") total = event.data.contentLength ?? 0;
      else if (event.event === "Progress") {
        received += event.data.chunkLength;
        updater.progress = total > 0 ? Math.min(1, received / total) : 0;
      }
    });
    updater.phase = "installing";
    await flushBeforeAppQuit();
    // On Windows the passive NSIS installer closes hive, installs and starts the new version.
    await pending.install();
  } catch (error) {
    updater.phase = "error";
    updater.error = error instanceof Error ? error.message : String(error);
  }
}

export function dismissUpdate(): void {
  if (updater.phase === "downloading" || updater.phase === "installing") return;
  updater.phase = "idle";
}
