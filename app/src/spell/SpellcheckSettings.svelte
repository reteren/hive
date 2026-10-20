<script lang="ts">
  import SettingToggle from "../settings/SettingToggle.svelte";
  import { spellSettings, setInlineSpellSuggestions, setSpellcheckEnabled, setSpellcheckLanguage } from "./settings.svelte";
</script>

<section class="settings-block" aria-labelledby="spellcheck-settings-title">
  <div class="settings-block-header"><h3 id="spellcheck-settings-title" class="settings-block-title">Spellcheck</h3></div>
  <div class="settings-group">
    <SettingToggle
      label="Spellcheck"
      description="Underline misspelled words while editing notes."
      checked={spellSettings.enabled}
      onchange={setSpellcheckEnabled}
    />
    {#if spellSettings.enabled}
      <SettingToggle
        label="Inline suggestions"
        description="Show spelling suggestions above a misspelled word when the caret is on it."
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
