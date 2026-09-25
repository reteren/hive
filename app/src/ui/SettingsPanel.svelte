<script lang="ts">
  import { history, MAX_HISTORY_LIMIT, MIN_HISTORY_LIMIT, setHistoryLimit } from "../history/history.svelte";
  import { preferences, setFitWidthToText, setReduceAnimations } from "../settings/preferences.svelte";
  import { closeSettingsPanel, settingsPanel } from "../settings/settingsPanel.svelte";

  let historyLimitDraft = $state(String(history.limit));
  let closeButton = $state<HTMLButtonElement | null>(null);

  $effect(() => {
    historyLimitDraft = String(history.limit);
  });

  $effect(() => {
    if (!settingsPanel.open) return;
    const frame = requestAnimationFrame(() => closeButton?.focus());
    return () => cancelAnimationFrame(frame);
  });

  function handleKeydown(event: KeyboardEvent): void {
    if (event.key !== "Escape" || event.defaultPrevented) return;
    event.preventDefault();
    event.stopPropagation();
    closeSettingsPanel();
  }

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

{#if settingsPanel.open}
  <div class="settings-overlay" data-selection-ignore>
    <button class="settings-backdrop" type="button" aria-label="Close settings" onclick={closeSettingsPanel}></button>
    <div class="settings-window" role="dialog" aria-modal="true" aria-labelledby="settings-title" tabindex="-1" onkeydown={handleKeydown}>
      <header class="settings-heading">
        <h1 id="settings-title">Settings</h1>
        <button bind:this={closeButton} class="close-button" type="button" aria-label="Close settings" title="Close settings" onclick={closeSettingsPanel}>×</button>
      </header>

      <div class="settings-content">
        <section class="settings-section" aria-labelledby="general-settings-title">
          <h2 id="general-settings-title">General</h2>
          <label class="setting-row">
            <span class="setting-copy">
              <span>Reduce animations</span>
              <span class="setting-description">Use less motion throughout the interface.</span>
            </span>
            <input
              type="checkbox"
              checked={preferences.reduceAnimations}
              onchange={(event) => setReduceAnimations(event.currentTarget.checked)}
            />
          </label>
          <label class="setting-row">
            <span class="setting-copy">
              <span>Fit note width to text (beta)</span>
              <span class="setting-description">Grow while typing to keep each line unwrapped.</span>
            </span>
            <input
              type="checkbox"
              checked={preferences.fitWidthToText}
              onchange={(event) => setFitWidthToText(event.currentTarget.checked)}
            />
          </label>
        </section>

        <section class="settings-section" aria-labelledby="history-settings-title">
          <h2 id="history-settings-title">History</h2>
          <label class="setting-row">
            <span class="setting-copy">
              <span>Undo history limit</span>
              <span class="setting-description">Retain between {MIN_HISTORY_LIMIT} and {MAX_HISTORY_LIMIT} steps.</span>
            </span>
            <input
              class="history-limit"
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
          </label>
        </section>
      </div>
    </div>
  </div>
{/if}

<style>
  .settings-overlay {
    position: fixed;
    z-index: 1001;
    inset: 0;
    display: grid;
    place-items: center;
    padding: 12px;
  }

  .settings-backdrop {
    position: absolute;
    inset: 0;
    border: 0;
    background: rgb(0 0 0 / 48%);
    cursor: default;
  }

  .settings-window {
    position: relative;
    display: flex;
    width: min(420px, 100%);
    max-height: min(520px, 100%);
    flex-direction: column;
    overflow: hidden;
    border: 1px solid #4b4b4b;
    border-radius: 5px;
    background: var(--bg-panel);
    box-shadow: 0 12px 36px rgb(0 0 0 / 58%);
    color: var(--text);
  }

  .settings-heading {
    display: flex;
    min-height: 38px;
    align-items: center;
    justify-content: space-between;
    padding: 4px 7px 4px 12px;
    border-bottom: 1px solid #3b3b3b;
  }

  h1 {
    margin: 0;
    font-size: 13px;
    font-weight: 600;
  }

  .close-button {
    width: 26px;
    height: 26px;
    padding: 0;
    border: 1px solid transparent;
    border-radius: 3px;
    background: transparent;
    color: var(--text-dim);
    font: inherit;
    font-size: 18px;
    line-height: 1;
    cursor: pointer;
  }

  .close-button:hover,
  .close-button:focus-visible {
    border-color: #555;
    background: #333;
    color: var(--text);
  }

  .settings-content {
    min-height: 0;
    overflow: auto;
    padding: 4px 12px 12px;
  }

  .settings-section {
    padding: 9px 0 3px;
  }

  .settings-section + .settings-section {
    margin-top: 6px;
    border-top: 1px solid #3b3b3b;
  }

  h2 {
    margin: 0 0 7px;
    color: var(--text-dim);
    font-size: 10px;
    font-weight: 600;
    letter-spacing: 0.04em;
    text-transform: uppercase;
  }

  .setting-row {
    display: flex;
    min-height: 38px;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    padding: 4px 2px;
    font-size: 11px;
  }

  .setting-copy {
    display: flex;
    min-width: 0;
    flex-direction: column;
    gap: 3px;
  }

  .setting-description {
    color: var(--text-dim);
    font-size: 9px;
    line-height: 1.35;
  }

  input[type="checkbox"] {
    width: 15px;
    height: 15px;
    flex: 0 0 auto;
    accent-color: var(--accent);
  }

  .history-limit {
    width: 64px;
    height: 24px;
    flex: 0 0 auto;
    padding: 2px 5px;
    border: 1px solid #484848;
    border-radius: 3px;
    background: #181818;
    color: var(--text);
    font: inherit;
    font-family: var(--mono-font);
    font-variant-numeric: tabular-nums;
    text-align: right;
  }

  .history-limit:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: 1px;
  }
</style>
