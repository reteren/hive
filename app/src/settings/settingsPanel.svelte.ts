export const settingsPanel = $state({ open: false });

export function toggleSettingsPanel(): void {
  settingsPanel.open = !settingsPanel.open;
}

export function closeSettingsPanel(): void {
  settingsPanel.open = false;
}
