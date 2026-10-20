<script lang="ts">
  import ProfileSettings from "../ProfileSettings.svelte";
  import QuickInputShortcutSetting from "../QuickInputShortcutSetting.svelte";
  import SettingToggle from "../SettingToggle.svelte";
  import { preferences, setReduceAnimations } from "../preferences.svelte";
  import { closeSettingsPanel } from "../settingsPanel.svelte";
  import { openKeymapPanel } from "../../commands/keymapPanel.svelte";

  function openKeyBindings(): void {
    closeSettingsPanel();
    openKeymapPanel();
  }
</script>

<ProfileSettings />

<section class="settings-block" aria-labelledby="interface-settings-title">
  <div class="settings-block-header"><h3 id="interface-settings-title" class="settings-block-title">Interface</h3></div>
  <div class="settings-group">
    <SettingToggle
      label="Reduce animations"
      description="Turn off small decorative motion: hover spins, press bounces, animated frames."
      checked={preferences.reduceAnimations}
      onchange={setReduceAnimations}
    />
  </div>
</section>

<section class="settings-block" aria-labelledby="shortcut-settings-title">
  <div class="settings-block-header"><h3 id="shortcut-settings-title" class="settings-block-title">Shortcuts</h3></div>
  <div class="settings-group">
    <QuickInputShortcutSetting />
    <div class="setting-row">
      <span class="setting-copy">
        <span class="setting-title">Key bindings</span>
        <span class="setting-description">Change the keys for tools and commands.</span>
      </span>
      <button class="settings-button" type="button" data-settings-open-keymap onclick={openKeyBindings}>Edit key bindings…</button>
    </div>
  </div>
</section>
