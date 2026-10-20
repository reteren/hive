<script lang="ts">
  import SettingToggle from "../settings/SettingToggle.svelte";
  import { spellSettings, setInlineSpellSuggestions, setSpellcheckEnabled, setSpellcheckLanguage } from "./settings.svelte";
  import { t } from "../i18n/i18n.svelte";
</script>

<section class="settings-block" aria-labelledby="spellcheck-settings-title">
  <div class="settings-block-header"><h3 id="spellcheck-settings-title" class="settings-block-title">{t("Spellcheck")}</h3></div>
  <div class="settings-group">
    <SettingToggle
      label={t("Spellcheck")}
      description={t("Underline misspelled words while editing notes.")}
      checked={spellSettings.enabled}
      onchange={setSpellcheckEnabled}
    />
    {#if spellSettings.enabled}
      <SettingToggle
        label={t("Inline suggestions")}
        description={t("Show spelling suggestions above a misspelled word when the caret is on it.")}
        checked={spellSettings.inlineSuggestions}
        onchange={setInlineSpellSuggestions}
      />
      {#each spellSettings.availableLanguages as language (language.tag)}
        <SettingToggle
          label={language.name}
          nested
          checked={spellSettings.languages.includes(language.tag)}
          onchange={(checked) => setSpellcheckLanguage(language.tag, checked)}
        />
      {/each}
    {/if}
  </div>
</section>
