import { registerCommand } from "../commands/registry.svelte";
import { settingsPanel, toggleSettingsPanel } from "./settingsPanel.svelte";

registerCommand({
  id: "ui.settings",
  label: "Settings",
  keys: ["Ctrl+Comma"],
  run: toggleSettingsPanel,
  isActive: () => settingsPanel.open,
});
