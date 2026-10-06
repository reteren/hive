<script lang="ts">
  import { spellSettings, setInlineSpellSuggestions, setSpellcheckEnabled, setSpellcheckLanguage } from "./settings.svelte";
</script>

<section class="settings-section" aria-labelledby="spellcheck-settings-title">
  <h2 id="spellcheck-settings-title">Spellcheck</h2>
  <label class="setting-row">
    <span class="setting-copy"><span>Spellcheck</span><span class="setting-description">Underline misspelled words while editing notes.</span></span>
    <input type="checkbox" checked={spellSettings.enabled} onchange={(event) => setSpellcheckEnabled(event.currentTarget.checked)} />
  </label>
  {#if spellSettings.enabled}
    <label class="setting-row">
      <span class="setting-copy"><span>Inline suggestions</span><span class="setting-description">Show spelling suggestions above a misspelled word when the caret is on it.</span></span>
      <input type="checkbox" checked={spellSettings.inlineSuggestions} onchange={(event) => setInlineSpellSuggestions(event.currentTarget.checked)} />
    </label>
    {#each spellSettings.availableLanguages as language (language.tag)}
      <label class="setting-row spell-language-row">
        <span class="setting-copy"><span>{language.name}</span></span>
        <input
          type="checkbox"
          checked={spellSettings.languages.includes(language.tag)}
          onchange={(event) => setSpellcheckLanguage(language.tag, event.currentTarget.checked)}
        />
      </label>
    {/each}
  {/if}
</section>

<style>
  .settings-section { padding: 9px 0 3px; margin-top: 6px; border-top: 1px solid #3b3b3b; }
  h2 { margin: 0 0 7px; color: var(--text-dim); font-size: 10px; font-weight: 600; letter-spacing: 0.04em; text-transform: uppercase; }
  .setting-row { display: flex; min-height: 38px; align-items: center; justify-content: space-between; gap: 12px; padding: 4px 2px; font-size: 11px; }
  .setting-copy { display: flex; min-width: 0; flex-direction: column; gap: 3px; }
  .setting-description { color: var(--text-dim); font-size: 9px; line-height: 1.35; }
  input[type="checkbox"] { width: 15px; height: 15px; flex: 0 0 auto; accent-color: var(--accent); }
  .spell-language-row { min-height: 30px; padding-left: 12px; }
</style>
