export type SettingsPage = "general" | "appearance" | "editing" | "media" | "ai" | "storage";

// The page survives closing the window, so reopening the settings lands where the user left off.
export const settingsPanel = $state<{ open: boolean; page: SettingsPage }>({ open: false, page: "general" });

export function toggleSettingsPanel(): void {
  settingsPanel.open = !settingsPanel.open;
}

export function closeSettingsPanel(): void {
  settingsPanel.open = false;
}

export function openSettingsPage(page: SettingsPage): void {
  settingsPanel.page = page;
  settingsPanel.open = true;
}
