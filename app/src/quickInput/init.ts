import { invoke, isTauri } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { WebviewWindow } from "@tauri-apps/api/webviewWindow";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { initializeProjectPersistence } from "../project/persistence.svelte";
import { initializeViewSettingsPersistence } from "../settings/persistence.svelte";
import { initializeQuickInputShortcut } from "./shortcutRegistration";

let toastTimer: number | null = null;
let toastElement: HTMLElement | null = null;
let quitRequested = false;

if (isTauri()) void initializeQuickInputMain();

async function initializeQuickInputMain(): Promise<void> {
  const window = getCurrentWindow();

  await listen("hive://tray-first-close", showFirstTrayNotice);
  await listen("hive://main-restored", clearTrayNotice);
  await listen("hive://quit-request", async () => {
    if (quitRequested) return;
    quitRequested = true;
    clearTrayNotice();
    try {
      await invoke("set_quit_requested", { requested: true });
      await window.close();
    } catch (error) {
      quitRequested = false;
      await invoke("set_quit_requested", { requested: false }).catch(() => undefined);
      console.error("Could not quit hive after the close flush.", error);
    }
  });

  await initializeViewSettingsPersistence();
  await initializeProjectPersistence();
  await initializeQuickInputShortcut(() => void toggleQuickInputWindow());
}

async function toggleQuickInputWindow(): Promise<void> {
  const quickInput = await WebviewWindow.getByLabel("quick-input");
  if (!quickInput) {
    console.error("The quick input window is unavailable.");
    return;
  }

  try {
    if (await quickInput.isVisible()) {
      await quickInput.hide();
      return;
    }
    await quickInput.center();
    await quickInput.show();
    await quickInput.setFocus();
  } catch (error) {
    console.error("Could not open the quick input window.", error);
  }
}

function showFirstTrayNotice(): void {
  clearTrayNotice();
  const notice = document.createElement("div");
  notice.textContent = "hive is still running in the tray";
  notice.dataset.trayNotice = "true";
  Object.assign(notice.style, {
    position: "fixed",
    zIndex: "2147483647",
    top: "12px",
    left: "50%",
    transform: "translateX(-50%)",
    padding: "9px 13px",
    border: "1px solid #66562c",
    borderRadius: "4px",
    background: "#282315",
    boxShadow: "0 8px 24px rgb(0 0 0 / 45%)",
    color: "#f1df9e",
    font: "11px Inter, 'Segoe UI', sans-serif",
    pointerEvents: "none",
  });
  document.body.append(notice);
  toastElement = notice;
  toastTimer = window.setTimeout(() => {
    clearTrayNotice();
  }, 1800);
}

function clearTrayNotice(): void {
  if (toastTimer !== null) {
    window.clearTimeout(toastTimer);
    toastTimer = null;
  }
  toastElement?.remove();
  toastElement = null;
}
