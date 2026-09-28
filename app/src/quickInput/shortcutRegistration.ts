import { invoke, isTauri } from "@tauri-apps/api/core";
import { register, unregister } from "@tauri-apps/plugin-global-shortcut";
import { quickInputShortcut, setQuickInputShortcutError } from "../settings/quickInputShortcut.svelte";
import { normalizeQuickInputShortcut } from "./shortcutModel";

type ShortcutEvent = { state: "Pressed" | "Released" };
type ShortcutBackend = "hook" | "plugin";

let activeShortcut: string | null = null;
let activeBackend: ShortcutBackend | null = null;
let suspendedShortcut: string | null = null;
let onShortcut: () => void = () => undefined;

export async function initializeQuickInputShortcut(onActivate: () => void): Promise<void> {
  onShortcut = onActivate;
  if (!isTauri()) return;

  await registerConfiguredShortcut(quickInputShortcut.value);
}

export async function updateQuickInputShortcut(value: string): Promise<boolean> {
  const normalized = normalizeQuickInputShortcut(value);
  if (!normalized) {
    setQuickInputShortcutError("Use a supported key with Ctrl, Alt, or the Windows key.");
    return false;
  }
  if (normalized === activeShortcut && activeBackend) {
    quickInputShortcut.value = normalized;
    setQuickInputShortcutError("");
    return true;
  }
  if (!isTauri()) {
    quickInputShortcut.value = normalized;
    setQuickInputShortcutError("Global shortcuts are available in the desktop app.");
    return false;
  }

  if (await activateShortcut(normalized)) {
    quickInputShortcut.value = normalized;
    setQuickInputShortcutError("");
    return true;
  }

  const registrationError = quickInputShortcut.error;
  if (suspendedShortcut) {
    await restoreQuickInputShortcutAfterCapture();
    setQuickInputShortcutError(registrationError);
  }
  return false;
}

export async function suspendQuickInputShortcutForCapture(): Promise<void> {
  if (!isTauri() || !activeShortcut || !activeBackend) return;
  const shortcut = activeShortcut;

  if (activeBackend === "hook") {
    const paused = await configureWindowsHook(null);
    if (!paused) throw new Error("Could not pause the quick input shortcut for capture.");
  } else {
    await unregister(shortcut);
  }

  suspendedShortcut = shortcut;
  activeShortcut = null;
  activeBackend = null;
}

export async function restoreQuickInputShortcutAfterCapture(): Promise<void> {
  if (!isTauri() || !suspendedShortcut) return;
  const previousShortcut = suspendedShortcut;
  if (await activateShortcut(previousShortcut)) {
    quickInputShortcut.value = previousShortcut;
    setQuickInputShortcutError("");
  }
}

async function registerConfiguredShortcut(value: string): Promise<void> {
  const normalized = normalizeQuickInputShortcut(value);
  if (!normalized) {
    setQuickInputShortcutError("The saved shortcut is invalid. Choose a new key combination.");
    return;
  }

  if (await activateShortcut(normalized)) {
    quickInputShortcut.value = normalized;
    setQuickInputShortcutError("");
  }
}

/** Windows uses the low-level hook first so an existing app binding cannot block hive. */
async function activateShortcut(shortcut: string): Promise<boolean> {
  const previousShortcut = activeShortcut;
  const previousBackend = activeBackend;

  if (await configureWindowsHook(shortcut)) {
    if (previousBackend === "plugin" && previousShortcut && previousShortcut !== shortcut) {
      await unregisterIgnoringFailure(previousShortcut);
    }
    activeShortcut = shortcut;
    activeBackend = "hook";
    suspendedShortcut = null;
    setQuickInputShortcutError("");
    return true;
  }

  try {
    await register(shortcut, handleShortcut);
  } catch (error) {
    setQuickInputShortcutError(formatRegistrationError(error));
    return false;
  }

  if (previousBackend === "plugin" && previousShortcut && previousShortcut !== shortcut) {
    await unregisterIgnoringFailure(previousShortcut);
  } else if (previousBackend === "hook" && previousShortcut && previousShortcut !== shortcut) {
    await configureWindowsHook(null);
  }
  activeShortcut = shortcut;
  activeBackend = "plugin";
  suspendedShortcut = null;
  setQuickInputShortcutError("");
  return true;
}

async function configureWindowsHook(shortcut: string | null): Promise<boolean> {
  try {
    return await invoke<boolean>("configure_quick_input_shortcut", { shortcut });
  } catch {
    // Non-Windows builds do not expose the hook command; use Tauri's plugin there.
    return false;
  }
}

async function unregisterIgnoringFailure(shortcut: string): Promise<void> {
  try {
    await unregister(shortcut);
  } catch {
    // The replacement is already active; a stale plugin registration must not undo it.
  }
}

function handleShortcut(event: ShortcutEvent): void {
  if (event.state === "Pressed") onShortcut();
}

function formatRegistrationError(error: unknown): string {
  const detail = error instanceof Error ? error.message : String(error);
  return `Could not register this shortcut. Another app may already use it. Choose a different combination. ${detail}`;
}
