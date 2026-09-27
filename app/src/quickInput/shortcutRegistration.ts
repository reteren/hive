import { isTauri } from "@tauri-apps/api/core";
import { register, unregister } from "@tauri-apps/plugin-global-shortcut";
import { quickInputShortcut, setQuickInputShortcutError } from "../settings/quickInputShortcut.svelte";
import { normalizeQuickInputShortcut } from "./shortcutModel";

type ShortcutEvent = { state: "Pressed" | "Released" };

let activeShortcut: string | null = null;
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
  if (normalized === activeShortcut) {
    quickInputShortcut.value = normalized;
    setQuickInputShortcutError("");
    return true;
  }
  if (!isTauri()) {
    quickInputShortcut.value = normalized;
    setQuickInputShortcutError("Global shortcuts are available in the desktop app.");
    return false;
  }

  const previousShortcut = activeShortcut ?? suspendedShortcut;
  let newShortcutRegistered = false;
  try {
    await register(normalized, handleShortcut);
    newShortcutRegistered = true;
    if (activeShortcut && activeShortcut !== normalized) await unregister(activeShortcut);
    activeShortcut = normalized;
    suspendedShortcut = null;
    quickInputShortcut.value = normalized;
    setQuickInputShortcutError("");
    return true;
  } catch (error) {
    if (newShortcutRegistered) {
      try {
        await unregister(normalized);
      } catch {
        // Preserve the original registration failure for the Settings message.
      }
    }
    if (suspendedShortcut) {
      try {
        await register(suspendedShortcut, handleShortcut);
        activeShortcut = suspendedShortcut;
        suspendedShortcut = null;
      } catch {
        // The Settings error below explains the failed replacement.
      }
    } else if (!activeShortcut && previousShortcut) {
      activeShortcut = previousShortcut;
    }
    setQuickInputShortcutError(formatRegistrationError(error));
    return false;
  }
}

export async function suspendQuickInputShortcutForCapture(): Promise<void> {
  if (!isTauri() || !activeShortcut) return;
  const shortcut = activeShortcut;
  await unregister(shortcut);
  suspendedShortcut = shortcut;
  activeShortcut = null;
}

export async function restoreQuickInputShortcutAfterCapture(): Promise<void> {
  if (!isTauri() || !suspendedShortcut) return;
  const previousShortcut = suspendedShortcut;
  try {
    await register(previousShortcut, handleShortcut);
    activeShortcut = previousShortcut;
    suspendedShortcut = null;
    setQuickInputShortcutError("");
  } catch (error) {
    setQuickInputShortcutError(formatRegistrationError(error));
  }
}

async function registerConfiguredShortcut(value: string): Promise<void> {
  const normalized = normalizeQuickInputShortcut(value);
  if (!normalized) {
    setQuickInputShortcutError("The saved shortcut is invalid. Choose a new key combination.");
    return;
  }

  try {
    await register(normalized, handleShortcut);
    activeShortcut = normalized;
    quickInputShortcut.value = normalized;
    setQuickInputShortcutError("");
  } catch (error) {
    setQuickInputShortcutError(formatRegistrationError(error));
  }
}

function handleShortcut(event: ShortcutEvent): void {
  if (event.state === "Pressed") onShortcut();
}

function formatRegistrationError(error: unknown): string {
  const detail = error instanceof Error ? error.message : String(error);
  return `Could not register this shortcut. Another app may already use it. Choose a different combination. ${detail}`;
}
