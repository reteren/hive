import { DEFAULT_PROFILE_NAME, type SettingsProfiles } from "./profiles";

/** R11.4 settings profiles in use; persisted with the view settings (settings/persistence.svelte.ts). */
export const settingsProfiles = $state<SettingsProfiles>({
  active: "default",
  list: [{ id: "default", name: DEFAULT_PROFILE_NAME, settings: {} }],
});

export function setSettingsProfiles(next: SettingsProfiles): void {
  settingsProfiles.active = next.active;
  settingsProfiles.list = next.list;
}
