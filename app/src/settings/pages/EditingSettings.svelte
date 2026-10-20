<script lang="ts">
  import SettingToggle from "../SettingToggle.svelte";
  import SpellcheckSettings from "../../spell/SpellcheckSettings.svelte";
  import { preferences, setFitWidthToText } from "../preferences.svelte";
  import { history, MAX_HISTORY_LIMIT, MIN_HISTORY_LIMIT, setHistoryLimit } from "../../history/history.svelte";

  let historyLimitDraft = $state(String(history.limit));

  $effect(() => {
    historyLimitDraft = String(history.limit);
  });

  function changeHistoryLimit(event: Event): void {
    if (!(event.currentTarget instanceof HTMLInputElement)) return;
    setHistoryLimit(event.currentTarget.valueAsNumber);
    historyLimitDraft = String(history.limit);
  }

  function handleHistoryLimitKeydown(event: KeyboardEvent): void {
    const input = event.currentTarget;
    if (!(input instanceof HTMLInputElement)) return;
    if (event.key === "Enter") {
      input.blur();
    } else if (event.key === "Escape") {
      event.stopPropagation();
      historyLimitDraft = String(history.limit);
      input.blur();
    }
  }
</script>

<section class="settings-block" aria-labelledby="notes-settings-title">
  <div class="settings-block-header"><h3 id="notes-settings-title" class="settings-block-title">Notes</h3></div>
  <div class="settings-group">
    <SettingToggle
      label="Fit note width to text (beta)"
      description="Grow while typing to keep each line unwrapped."
      checked={preferences.fitWidthToText}
      onchange={setFitWidthToText}
    />
  </div>
</section>

<SpellcheckSettings />

<section class="settings-block" aria-labelledby="history-settings-title">
  <div class="settings-block-header"><h3 id="history-settings-title" class="settings-block-title">Undo</h3></div>
  <div class="settings-group">
    <label class="setting-row">
      <span class="setting-copy">
        <span class="setting-title">Undo history limit</span>
        <span class="setting-description">Keep between {MIN_HISTORY_LIMIT} and {MAX_HISTORY_LIMIT} steps you can undo.</span>
      </span>
      <span class="setting-control">
        <input
          class="settings-input"
          type="number"
          min={MIN_HISTORY_LIMIT}
          max={MAX_HISTORY_LIMIT}
          step="1"
          value={historyLimitDraft}
          aria-label={`Undo history limit, from ${MIN_HISTORY_LIMIT} to ${MAX_HISTORY_LIMIT}`}
          oninput={(event) => (historyLimitDraft = event.currentTarget.value)}
          onchange={changeHistoryLimit}
          onkeydown={handleHistoryLimitKeydown}
        />
        <span class="setting-unit">steps</span>
      </span>
    </label>
  </div>
</section>
