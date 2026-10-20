<script lang="ts">
  import { tick } from "svelte";
  import HexColorPicker from "../color/HexColorPicker.svelte";
  import ThemePreviewCard from "./ThemePreviewCard.svelte";
  import {
    appearance,
    applyThemePreset,
    createThemePreset,
    deleteThemePreset,
    duplicateThemePreset,
    renameThemePreset,
    setThemeColor,
  } from "./appearance.svelte";
  import { BUILTIN_THEME_PRESETS } from "./presets";
  import type { ThemeColors } from "./colors";

  type ColorKey = keyof ThemeColors;
  type PresetEditor = { kind: "create" } | { kind: "rename" | "duplicate"; id: string };

  const colorRows: ReadonlyArray<{ key: ColorKey; label: string; description: string }> = [
    { key: "base", label: "Base", description: "Panels, menus, and popovers" },
    { key: "accent", label: "Accent", description: "Selections, highlights, and active controls" },
    { key: "icon", label: "Icons", description: "SVG and raster icons" },
    { key: "board", label: "Board background", description: "Workspace behind the grid" },
    { key: "grid", label: "Grid lines", description: "Minor and major grid lines" },
  ];

  let openColorPicker = $state<ColorKey | null>(null);
  let presetEditor = $state<PresetEditor | null>(null);
  let presetNameDraft = $state("");
  let presetNameInput = $state<HTMLInputElement | null>(null);
  let confirmingDeleteId = $state<string | null>(null);
  const userPresets = $derived(appearance.settings.userPresets);
  const activeId = $derived(appearance.settings.activePresetId);
  const confirmingDeletePreset = $derived(userPresets.find((preset) => preset.id === confirmingDeleteId));

  function toggleColorPicker(key: ColorKey): void {
    openColorPicker = openColorPicker === key ? null : key;
  }

  function beginPresetEdit(editor: PresetEditor, initialName = ""): void {
    confirmingDeleteId = null;
    presetEditor = editor;
    presetNameDraft = initialName;
    void tick().then(() => {
      presetNameInput?.focus();
      presetNameInput?.select();
    });
  }

  function beginRename(id: string): void {
    const preset = userPresets.find((item) => item.id === id);
    if (preset) beginPresetEdit({ kind: "rename", id }, preset.name);
  }

  function beginDuplicate(id: string): void {
    const preset = userPresets.find((item) => item.id === id);
    if (preset) beginPresetEdit({ kind: "duplicate", id }, `${preset.name} copy`);
  }

  function savePresetName(event: SubmitEvent): void {
    event.preventDefault();
    if (!presetEditor) return;
    if (presetEditor.kind === "create") createThemePreset(presetNameDraft);
    else if (presetEditor.kind === "rename") renameThemePreset(presetEditor.id, presetNameDraft);
    else duplicateThemePreset(presetEditor.id, presetNameDraft);
    presetEditor = null;
    presetNameDraft = "";
  }

  function cancelPresetEdit(): void {
    presetEditor = null;
    presetNameDraft = "";
  }

  function confirmDelete(): void {
    if (confirmingDeleteId) deleteThemePreset(confirmingDeleteId);
    confirmingDeleteId = null;
  }
</script>

<section class="settings-block" aria-labelledby="appearance-themes-title" data-appearance-settings>
  <div class="settings-block-header">
    <h3 id="appearance-themes-title" class="settings-block-title">Themes</h3>
  </div>
  <div class="theme-gallery" role="list" aria-label="Appearance presets">
    {#each BUILTIN_THEME_PRESETS as preset (preset.id)}
      <div class="theme-tile" role="listitem" data-theme-preset={preset.id}>
        <ThemePreviewCard
          name={preset.name}
          colors={preset.colors}
          active={activeId === preset.id}
          label={`Apply ${preset.name} theme`}
          onclick={() => applyThemePreset(preset.id)}
        />
      </div>
    {/each}
  </div>
</section>

<section class="settings-block" aria-labelledby="appearance-user-title">
  <div class="settings-block-header">
    <h3 id="appearance-user-title" class="settings-block-title">Your themes</h3>
    <button class="settings-button" class:is-primary={activeId === null} type="button" data-save-theme-preset onclick={() => beginPresetEdit({ kind: "create" })}>Save current as theme…</button>
  </div>

  {#if presetEditor || confirmingDeletePreset}
    <div class="settings-group">
      {#if presetEditor}
        <form class="settings-inline-panel" data-preset-editor onsubmit={savePresetName}>
          <label for="appearance-preset-name">
            {presetEditor.kind === "create" ? "Save the current colours as a theme" : presetEditor.kind === "rename" ? "Rename theme" : "Duplicate theme"}
          </label>
          <input
            id="appearance-preset-name"
            class="settings-input is-text"
            bind:this={presetNameInput}
            bind:value={presetNameDraft}
            maxlength="36"
            autocomplete="off"
            required
            aria-label="Theme name"
            onkeydown={(event) => { if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); cancelPresetEdit(); } }}
          />
          <span class="setting-control">
            <button class="settings-button" type="button" onclick={cancelPresetEdit}>Cancel</button>
            <button class="settings-button is-primary" type="submit">Save</button>
          </span>
        </form>
      {:else if confirmingDeletePreset}
        <div class="settings-inline-panel is-danger" role="alertdialog" aria-label="Delete theme">
          <p>Delete the theme “{confirmingDeletePreset.name}”?</p>
          <span class="setting-control">
            <button class="settings-button" type="button" onclick={() => (confirmingDeleteId = null)}>Cancel</button>
            <button class="settings-button is-danger is-solid" type="button" onclick={confirmDelete}>Delete</button>
          </span>
        </div>
      {/if}
    </div>
  {/if}

  {#if userPresets.length > 0 || activeId === null}
    <div class="theme-gallery" role="list" aria-label="Your themes">
      {#if activeId === null}
        <div class="theme-tile" role="listitem" data-theme-preset="custom">
          <ThemePreviewCard
            name="Current colours"
            badge="unsaved"
            colors={appearance.settings.colors}
            active
            label="Current colours, not saved as a theme. Save it"
            onclick={() => beginPresetEdit({ kind: "create" })}
          />
        </div>
      {/if}
      {#each userPresets as preset (preset.id)}
        <div class="theme-tile has-tools" role="listitem" data-theme-preset={preset.id}>
          <ThemePreviewCard
            name={preset.name}
            colors={preset.colors}
            active={activeId === preset.id}
            label={`Apply ${preset.name} theme`}
            onclick={() => applyThemePreset(preset.id)}
          />
          <span class="theme-tools" aria-label={`${preset.name} theme actions`}>
            <button class="settings-icon-button" type="button" title="Rename" aria-label={`Rename ${preset.name}`} onclick={() => beginRename(preset.id)}>
              <svg viewBox="0 0 16 16"><path d="M10.5 2.8l2.7 2.7-7.6 7.6H2.9v-2.7z" /></svg>
            </button>
            <button class="settings-icon-button" type="button" title="Duplicate" aria-label={`Duplicate ${preset.name}`} onclick={() => beginDuplicate(preset.id)}>
              <svg viewBox="0 0 16 16"><rect x="5.5" y="5.5" width="8" height="8" rx="1.5" /><path d="M10.5 3.5v-.5a1 1 0 0 0-1-1h-6a1 1 0 0 0-1 1v6a1 1 0 0 0 1 1h.5" /></svg>
            </button>
            <button class="settings-icon-button is-danger" type="button" title="Delete" aria-label={`Delete ${preset.name}`} onclick={() => { presetEditor = null; confirmingDeleteId = preset.id; }}>
              <svg viewBox="0 0 16 16"><path d="M3 4.5h10M6.5 4.5V3h3v1.5M4.5 4.5l.6 8.5h5.8l.6-8.5" /></svg>
            </button>
          </span>
        </div>
      {/each}
    </div>
  {:else}
    <p class="setting-hint">Change any colour below, then save it here as your own theme.</p>
  {/if}
</section>

<section class="settings-block" aria-labelledby="appearance-colors-title">
  <div class="settings-block-header"><h3 id="appearance-colors-title" class="settings-block-title">Colours</h3></div>
  <div class="settings-group" aria-label="Theme colours">
    {#each colorRows as row (row.key)}
      <div class="theme-color-row" class:open={openColorPicker === row.key} data-theme-color={row.key}>
        <button
          type="button"
          class="theme-color-trigger"
          aria-expanded={openColorPicker === row.key}
          aria-controls={`appearance-picker-${row.key}`}
          onclick={() => toggleColorPicker(row.key)}
        >
          <span class="color-chip" style:background={appearance.settings.colors[row.key]} aria-hidden="true"></span>
          <span class="setting-copy">
            <span class="setting-title">{row.label}</span>
            <span class="setting-description">{row.description}</span>
          </span>
          <span class="color-hex">{appearance.settings.colors[row.key]}</span>
          <span class="color-chevron" aria-hidden="true"></span>
        </button>
        {#if openColorPicker === row.key}
          <div class="color-picker-panel" id={`appearance-picker-${row.key}`}>
            <HexColorPicker
              value={appearance.settings.colors[row.key]}
              label={row.label}
              oninput={(hex) => setThemeColor(row.key, hex)}
              onchange={(hex) => setThemeColor(row.key, hex)}
            />
          </div>
        {/if}
      </div>
    {/each}
  </div>
  <p class="setting-hint">Applies to both windows immediately. Editing a colour turns the theme into your own, unsaved one.</p>
</section>

<style>
  .theme-gallery {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(176px, 1fr));
    gap: 14px;
  }

  .theme-tile {
    position: relative;
    min-width: 0;
  }

  .theme-tools {
    position: absolute;
    top: 7px;
    right: 7px;
    display: flex;
    gap: 2px;
    padding: 2px;
    border: 1px solid var(--settings-line-strong);
    border-radius: 8px;
    background: var(--bg-panel);
    box-shadow: 0 3px 10px rgb(0 0 0 / 30%);
    opacity: 0;
    transition: opacity var(--motion-quick) ease-out;
  }

  .theme-tile:hover .theme-tools,
  .theme-tile:focus-within .theme-tools {
    opacity: 1;
  }

  .theme-tools svg {
    fill: none;
    stroke: currentColor;
    stroke-linecap: round;
    stroke-linejoin: round;
    stroke-width: 1.4;
  }

  .theme-color-trigger {
    display: flex;
    width: 100%;
    min-height: 58px;
    align-items: center;
    gap: 14px;
    padding: 10px 16px;
    border: 0;
    background: transparent;
    color: var(--text);
    font: inherit;
    text-align: left;
    cursor: pointer;
  }

  .theme-color-trigger:hover { background: var(--settings-fill); }
  .theme-color-trigger:focus-visible { outline: 2px solid var(--accent); outline-offset: -2px; }
  .theme-color-trigger .setting-copy { flex: 1; }

  .color-chip {
    width: 30px;
    height: 30px;
    flex: 0 0 auto;
    border-radius: 8px;
    box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--text) 20%, transparent);
  }

  .color-hex {
    color: var(--text-dim);
    font-family: var(--mono-font);
    font-size: 11.5px;
    text-transform: uppercase;
  }

  .color-chevron {
    width: 7px;
    height: 7px;
    flex: 0 0 auto;
    margin: 0 2px 0 4px;
    border-right: 1.5px solid var(--text-dim);
    border-bottom: 1.5px solid var(--text-dim);
    rotate: -45deg;
    transition: rotate var(--motion-quick) ease-out;
  }

  .theme-color-row.open .color-chevron { rotate: 45deg; }
  .theme-color-row.open { background: var(--settings-fill); }
  .color-picker-panel { padding: 4px 16px 16px 60px; }
</style>
