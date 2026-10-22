<script lang="ts">
  import ProfileSettings from "../ProfileSettings.svelte";
  import QuickInputShortcutSetting from "../QuickInputShortcutSetting.svelte";
  import SettingToggle from "../SettingToggle.svelte";
  import { preferences, setReduceAnimations, setSimplifyZoomPercent } from "../preferences.svelte";
  import { MAX_SIMPLIFY_ZOOM_PERCENT } from "../simplifyZoom";
  import { closeSettingsPanel } from "../settingsPanel.svelte";
  import { openKeymapPanel } from "../../commands/keymapPanel.svelte";
  import Select from "../../ui/Select.svelte";
  import { LOCALES } from "../../i18n/locales";
  import { i18n, setLanguage, t } from "../../i18n/i18n.svelte";

  let simplifyLabel = $derived(preferences.simplifyZoomPercent === 0 ? t("Off") : `${preferences.simplifyZoomPercent}%`);

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
    <div class="setting-row is-stacked" data-settings-simplify-zoom>
      <span class="setting-range-head">
        <label class="setting-title" for="settings-simplify-zoom">{t("Simplify notes when zoomed out")}</label>
        <span class="setting-unit" data-settings-simplify-zoom-value>{simplifyLabel}</span>
      </span>
      <input
        id="settings-simplify-zoom"
        class="settings-range"
        type="range"
        min="0"
        max={MAX_SIMPLIFY_ZOOM_PERCENT}
        step="1"
        value={preferences.simplifyZoomPercent}
        aria-valuetext={simplifyLabel}
        style={`--range-fill: ${(preferences.simplifyZoomPercent / MAX_SIMPLIFY_ZOOM_PERCENT) * 100}%`}
        oninput={(event) => setSimplifyZoomPercent(event.currentTarget.valueAsNumber)}
      />
      <span class="setting-description">{t("Optimization: zoomed out below this level, notes are drawn as plain grey blocks so big boards stay smooth. Lower keeps text visible farther out; Off always draws notes in full and can slow down large boards.")}</span>
    </div>
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
