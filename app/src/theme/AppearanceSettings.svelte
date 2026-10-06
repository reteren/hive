<script lang="ts">
  import { tick } from "svelte";
  import HexColorPicker from "../color/HexColorPicker.svelte";
  import {
    appearance,
    applyThemePreset,
    createThemePreset,
    deleteThemePreset,
    duplicateThemePreset,
    renameThemePreset,
    resetThemeToHive,
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
  let presets = $derived([...BUILTIN_THEME_PRESETS, ...appearance.settings.userPresets]);
  let activeUserPreset = $derived(appearance.settings.userPresets.find((preset) => preset.id === appearance.settings.activePresetId));

  function toggleColorPicker(key: ColorKey): void {
    openColorPicker = openColorPicker === key ? null : key;
  }

  function beginPresetEdit(editor: PresetEditor, initialName = ""): void {
    presetEditor = editor;
    presetNameDraft = initialName;
    void tick().then(() => presetNameInput?.focus());
  }

  function beginRename(id: string): void {
    const preset = appearance.settings.userPresets.find((item) => item.id === id);
    if (preset) beginPresetEdit({ kind: "rename", id }, preset.name);
  }

  function beginDuplicate(id: string): void {
    const preset = appearance.settings.userPresets.find((item) => item.id === id);
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
</script>

<section class="settings-section appearance-settings" aria-labelledby="appearance-settings-title" data-appearance-settings>
  <h2 id="appearance-settings-title">Appearance</h2>

  <div class="preset-gallery" role="list" aria-label="Appearance presets">
    {#each presets as preset (preset.id)}
      <article class="preset-tile" role="listitem" class:active={appearance.settings.activePresetId === preset.id} data-theme-preset={preset.id}>
        <button
          class="preset-card"
          type="button"
          aria-label={`Apply ${preset.name} theme`}
          aria-pressed={appearance.settings.activePresetId === preset.id}
          onclick={() => applyThemePreset(preset.id)}
        >
          <span class="preset-swatches" aria-hidden="true">
            <span style:background={preset.colors.base}></span>
            <span style:background={preset.colors.accent}></span>
            <span style:background={preset.colors.icon}></span>
            <span style:background={preset.colors.board}></span>
            <span style:background={preset.colors.grid}></span>
          </span>
          <span class="preset-name">{preset.name}</span>
          {#if appearance.settings.activePresetId === preset.id}<span class="preset-active">Active</span>{/if}
        </button>
        {#if activeUserPreset?.id === preset.id}
          <div class="preset-actions" aria-label={`${preset.name} preset actions`}>
            <button type="button" onclick={() => beginRename(preset.id)}>Rename</button>
            <button type="button" onclick={() => beginDuplicate(preset.id)}>Duplicate</button>
            <button type="button" class="delete-preset" onclick={() => deleteThemePreset(preset.id)}>Delete</button>
          </div>
        {/if}
      </article>
    {/each}
  </div>

  {#if presetEditor}
    <form class="preset-editor" data-preset-editor onsubmit={savePresetName}>
      <label for="appearance-preset-name">
        {presetEditor.kind === "create" ? "Save current colours as a preset" : presetEditor.kind === "rename" ? "Rename preset" : "Duplicate preset"}
      </label>
      <div class="preset-editor-controls">
        <input
          id="appearance-preset-name"
          bind:this={presetNameInput}
          bind:value={presetNameDraft}
          maxlength="36"
          autocomplete="off"
          required
          aria-label="Preset name"
          onkeydown={(event) => { if (event.key === "Escape") { event.preventDefault(); cancelPresetEdit(); } }}
        />
        <button type="submit">Save</button>
        <button type="button" onclick={cancelPresetEdit}>Cancel</button>
      </div>
    </form>
  {/if}

  <div class="appearance-actions">
    <button type="button" data-save-theme-preset onclick={() => beginPresetEdit({ kind: "create" })}>Save as preset…</button>
    <button type="button" data-reset-theme onclick={resetThemeToHive}>Reset to Hive</button>
  </div>

  <div class="theme-colors" aria-label="Theme colours">
    {#each colorRows as row (row.key)}
      <div class="theme-color-row" data-theme-color={row.key}>
        <button
          type="button"
          class="theme-color-trigger"
          aria-expanded={openColorPicker === row.key}
          aria-controls={`appearance-picker-${row.key}`}
          onclick={() => toggleColorPicker(row.key)}
        >
          <span class="color-chip" style:background={appearance.settings.colors[row.key]} aria-hidden="true"></span>
          <span class="color-copy"><span>{row.label}</span><span class="color-description">{row.description}</span></span>
          <span class="color-hex">{appearance.settings.colors[row.key]}</span>
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
</section>

<style>
  .appearance-settings {
    --appearance-gap: 5px;
  }

  .preset-gallery {
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: var(--appearance-gap);
  }

  .preset-tile {
    min-width: 0;
    overflow: hidden;
    border: 1px solid var(--border);
    border-radius: 4px;
    background: var(--bg-panel-raised);
  }

  .preset-tile.active {
    border-color: var(--accent);
    box-shadow: inset 0 0 0 1px var(--accent);
  }

  .preset-card {
    display: grid;
    width: 100%;
    min-height: 48px;
    grid-template-columns: 1fr auto;
    align-items: center;
    gap: 4px 6px;
    padding: 6px;
    border: 0;
    color: var(--text);
    background: transparent;
    text-align: left;
    cursor: pointer;
  }

  .preset-swatches {
    display: flex;
    height: 12px;
    grid-column: 1 / -1;
    overflow: hidden;
    border: 1px solid var(--border);
    border-radius: 2px;
  }

  .preset-swatches span { flex: 1 1 20%; }
  .preset-name { overflow: hidden; font-size: 10px; text-overflow: ellipsis; white-space: nowrap; }
  .preset-active { color: var(--accent); font-size: 8px; font-weight: 600; }
  .preset-card:hover { background: var(--bg-hover); }

  .preset-actions,
  .appearance-actions,
  .preset-editor-controls {
    display: flex;
    flex-wrap: wrap;
    gap: 4px;
  }

  .preset-actions { padding: 0 5px 5px; }

  .preset-actions button,
  .appearance-actions button,
  .preset-editor button {
    min-height: 24px;
    padding: 3px 7px;
    border: 1px solid var(--border);
    border-radius: 3px;
    color: var(--text);
    background: var(--bg-panel-raised);
    font-size: 9px;
    cursor: pointer;
  }

  .preset-actions button:hover,
  .appearance-actions button:hover,
  .preset-editor button:hover { background: var(--bg-hover); }
  .preset-actions .delete-preset { color: #ffb0a6; }

  .appearance-actions { margin-top: 6px; }
  .appearance-actions button:first-child { border-color: var(--accent); }

  .preset-editor {
    display: grid;
    gap: 5px;
    margin-top: 6px;
    padding: 7px;
    border: 1px solid var(--border);
    border-radius: 4px;
    background: var(--bg-panel-raised);
    font-size: 10px;
  }

  .preset-editor-controls input {
    min-width: 0;
    flex: 1;
    height: 24px;
    padding: 3px 6px;
    border: 1px solid var(--border);
    border-radius: 3px;
    color: var(--text);
    background: var(--bg-panel);
    font: inherit;
  }

  .theme-colors { display: grid; gap: 2px; margin-top: 8px; }

  .theme-color-row {
    overflow: hidden;
    border: 1px solid transparent;
    border-radius: 3px;
  }

  .theme-color-row:has(.color-picker-panel) {
    border-color: var(--border);
    background: var(--bg-panel-raised);
  }

  .theme-color-trigger {
    display: flex;
    width: 100%;
    min-height: 34px;
    align-items: center;
    gap: 8px;
    padding: 3px 5px;
    border: 0;
    color: var(--text);
    background: transparent;
    text-align: left;
    cursor: pointer;
  }

  .theme-color-trigger:hover { background: var(--bg-hover); }
  .color-chip { width: 22px; height: 22px; flex: 0 0 auto; border: 1px solid var(--border); border-radius: 3px; }
  .color-copy { display: grid; min-width: 0; flex: 1; gap: 1px; font-size: 10px; }
  .color-description { overflow: hidden; color: var(--text-dim); font-size: 8px; text-overflow: ellipsis; white-space: nowrap; }
  .color-hex { color: var(--text-dim); font-family: var(--mono-font); font-size: 9px; text-transform: uppercase; }
  .color-picker-panel { padding: 5px 7px 8px 35px; }

  @media (max-width: 360px) {
    .preset-gallery { grid-template-columns: repeat(2, minmax(0, 1fr)); }
    .color-description { display: none; }
  }
</style>
