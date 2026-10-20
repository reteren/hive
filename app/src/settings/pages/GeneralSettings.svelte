<script lang="ts">
  import ProfileSettings from "../ProfileSettings.svelte";
  import QuickInputShortcutSetting from "../QuickInputShortcutSetting.svelte";
  import SettingToggle from "../SettingToggle.svelte";
  import { preferences, setReduceAnimations } from "../preferences.svelte";
  import { closeSettingsPanel } from "../settingsPanel.svelte";
  import { openKeymapPanel } from "../../commands/keymapPanel.svelte";
  import Select from "../../ui/Select.svelte";
  import { LOCALES } from "../../i18n/locales";
  import { i18n, setLanguage, t } from "../../i18n/i18n.svelte";

  function openKeyBindings(): void {
    closeSettingsPanel();
    openKeymapPanel();
  }
</script>

<ProfileSettings />

<section class="settings-block" aria-labelledby="interface-settings-title">
  <div class="settings-block-header"><h3 id="interface-settings-title" class="settings-block-title">{t("Interface")}</h3></div>
  <div class="settings-group">
    <div class="setting-row" data-settings-language>
      <span class="setting-copy">
        <span class="setting-title">{t("Language")}</span>
        <span class="setting-description">{t("Menus, buttons and messages. Your notes are not translated.")}</span>
      </span>
      <span class="settings-select">
        <Select
          id="settings-language"
          ariaLabel={t("Language")}
          value={i18n.locale}
          options={LOCALES.map((locale) => ({ value: locale.tag, label: locale.name }))}
          onchange={(value) => void setLanguage(value)}
        />
      </span>
    </div>
    <SettingToggle
      label={t("Reduce animations")}
      description={t("Turn off small decorative motion: hover spins, press bounces, animated frames.")}
      checked={preferences.reduceAnimations}
      onchange={setReduceAnimations}
    />
  </div>
</section>

<section class="settings-block" aria-labelledby="shortcut-settings-title">
  <div class="settings-block-header"><h3 id="shortcut-settings-title" class="settings-block-title">{t("Shortcuts")}</h3></div>
  <div class="settings-group">
    <QuickInputShortcutSetting />
    <div class="setting-row">
      <span class="setting-copy">
        <span class="setting-title">{t("Key bindings")}</span>
        <span class="setting-description">{t("Change the keys for tools and commands.")}</span>
      </span>
      <button class="settings-button" type="button" data-settings-open-keymap onclick={openKeyBindings}>{t("Edit key bindings…")}</button>
    </div>
  </div>
</section>
