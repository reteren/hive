<script module lang="ts">
  import "../export/commands";
  import "../settings/settings.css";
</script>

<script lang="ts">
  import { untrack, type Component } from "svelte";
  import CloseGlyph from "./CloseGlyph.svelte";
  import packageMetadata from "../../package.json";
  import { project } from "../project/project.svelte";
  import { refreshStorageStats } from "../export/actions";
  import { closeSettingsPanel, settingsPanel, type SettingsPage } from "../settings/settingsPanel.svelte";
  import { settingsProfiles } from "../settings/profileState.svelte";
  import ExportStatus from "../export/ExportStatus.svelte";
  import AppearanceSettings from "../theme/AppearanceSettings.svelte";
  import GeneralSettings from "../settings/pages/GeneralSettings.svelte";
  import EditingSettings from "../settings/pages/EditingSettings.svelte";
  import MediaSettings from "../settings/pages/MediaSettings.svelte";
  import AiToolsSettings from "../settings/pages/AiToolsSettings.svelte";
  import StorageSettings from "../settings/pages/StorageSettings.svelte";
  import { t } from "../i18n/i18n.svelte";

  interface PageInfo {
    id: SettingsPage;
    label: string;
    description: string;
    /** 16×16 stroke icon paths. */
    icon: string;
    body: Component;
  }

  const pages: readonly PageInfo[] = [
    {
      id: "general",
      get label() { return t("General"); },
      get description() { return t("Profile, language, motion and shortcuts."); },
      icon: "M2.5 4.5h6M11.5 4.5h2M2.5 8h2M7.5 8h6M2.5 11.5h7.5M13 11.5h.5M10 3v3M6 6.5v3M11.5 10v3",
      body: GeneralSettings,
    },
    {
      id: "appearance",
      get label() { return t("Appearance"); },
      get description() { return t("Themes and the five colours they are made of."); },
      icon: "M8 2.2a5.8 5.8 0 1 0 0 11.6c.9 0 1.4-.6 1.4-1.3 0-.9-.7-1.1-.7-1.9 0-.6.5-1.1 1.2-1.1h1.6a2.3 2.3 0 0 0 2.3-2.3C13.8 4.4 11.2 2.2 8 2.2zM5 7.2h.01M7 4.8h.01M10.2 5h.01",
      body: AppearanceSettings,
    },
    {
      id: "editing",
      get label() { return t("Editing"); },
      get description() { return t("Notes, spellcheck and undo."); },
      icon: "M10.4 2.6l3 3L6 13H3v-3zM8.9 4.1l3 3",
      body: EditingSettings,
    },
    {
      id: "media",
      get label() { return t("Media"); },
      get description() { return t("GIFs, audio recording and video files."); },
      icon: "M3.5 3h9A1.5 1.5 0 0 1 14 4.5v7a1.5 1.5 0 0 1-1.5 1.5h-9A1.5 1.5 0 0 1 2 11.5v-7A1.5 1.5 0 0 1 3.5 3zM6.8 6v4l3.2-2z",
      body: MediaSettings,
    },
    {
      id: "ai",
      get label() { return t("AI tools"); },
      get description() { return t("Let local AI clients work with the open project."); },
      icon: "M8 2l1.3 3.5L12.8 7 9.3 8.3 8 12l-1.3-3.7L3.2 7l3.5-1.5zM12.5 11l.5 1.4 1.4.6-1.4.5-.5 1.5-.5-1.5-1.5-.5 1.5-.6z",
      body: AiToolsSettings,
    },
    {
      id: "storage",
      get label() { return t("Storage"); },
      get description() { return t("Disk use, backups, trash and moving projects."); },
      icon: "M3 4c0-1.1 2.2-2 5-2s5 .9 5 2-2.2 2-5 2-5-.9-5-2zM3 4v8c0 1.1 2.2 2 5 2s5-.9 5-2V4M3 8c0 1.1 2.2 2 5 2s5-.9 5-2",
      body: StorageSettings,
    },
  ];

  let closeButton = $state<HTMLButtonElement | null>(null);
  let navList = $state<HTMLElement | null>(null);
  let content = $state<HTMLElement | null>(null);

  const current = $derived(pages.find((page) => page.id === settingsPanel.page) ?? pages[0]);
  const activeProfileName = $derived(settingsProfiles.list.find((profile) => profile.id === settingsProfiles.active)?.name);

  $effect(() => {
    if (!settingsPanel.open) return;
    // untrack: refreshStorageStats reads its own busy flag; tracked, finishing a refresh re-ran this
    // effect and started the next one — a full walk of the project folder every ~0.3 s while the
    // settings were open, on the app's main thread (wheel input stalled behind it).
    if (project.path) untrack(() => void refreshStorageStats());
    const frame = requestAnimationFrame(() => {
      const active = navList?.querySelector<HTMLButtonElement>("[aria-current='page']");
      (active ?? closeButton)?.focus();
    });
    return () => cancelAnimationFrame(frame);
  });

  function showPage(id: SettingsPage): void {
    if (settingsPanel.page === id) return;
    settingsPanel.page = id;
    content?.scrollTo({ top: 0 });
  }

  function handleKeydown(event: KeyboardEvent): void {
    if (event.key !== "Escape" || event.defaultPrevented) return;
    event.preventDefault();
    event.stopPropagation();
    closeSettingsPanel();
  }

  function handleNavKeydown(event: KeyboardEvent): void {
    if (event.key !== "ArrowDown" && event.key !== "ArrowUp" && event.key !== "Home" && event.key !== "End") return;
    event.preventDefault();
    const index = pages.findIndex((page) => page.id === settingsPanel.page);
    const next = event.key === "Home" ? 0
      : event.key === "End" ? pages.length - 1
      : (index + (event.key === "ArrowDown" ? 1 : -1) + pages.length) % pages.length;
    showPage(pages[next].id);
    navList?.querySelectorAll<HTMLButtonElement>(".settings-nav-item")[next]?.focus();
  }
</script>

<ExportStatus />

{#if settingsPanel.open}
  <div class="settings-overlay" data-selection-ignore>
    <button class="settings-backdrop" type="button" aria-label={t("Close settings")} onclick={closeSettingsPanel}></button>
    <div class="settings-window" role="dialog" aria-modal="true" aria-labelledby="settings-title" tabindex="-1" onkeydown={handleKeydown}>
      <aside class="settings-sidebar">
        <h1 id="settings-title">{t("Settings")}</h1>
        <nav bind:this={navList} class="settings-nav" aria-label={t("Settings sections")}>
          {#each pages as page (page.id)}
            <button
              class="settings-nav-item"
              type="button"
              aria-current={settingsPanel.page === page.id ? "page" : undefined}
              data-settings-page={page.id}
              aria-label={page.label}
              onclick={() => showPage(page.id)}
              onkeydown={handleNavKeydown}
            >
              <svg viewBox="0 0 16 16" aria-hidden="true"><path d={page.icon} /></svg>
              <span>{page.label}</span>
            </button>
          {/each}
        </nav>
        <footer class="settings-sidebar-footer">
          {#if activeProfileName}<span class="sidebar-profile" title={t("Settings profile")}>{t("Profile: {name}", { name: t(activeProfileName) })}</span>{/if}
          <span class="app-version" data-app-version>hive {packageMetadata.version}</span>
        </footer>
      </aside>

      <main class="settings-main">
        <header class="settings-page-header">
          <div>
            <h2>{current.label}</h2>
            <p>{current.description}</p>
          </div>
          <button bind:this={closeButton} class="close-button settings-close" type="button" aria-label={t("Close settings")} title={t("Close settings")} onclick={closeSettingsPanel}><CloseGlyph /></button>
        </header>
        <div bind:this={content} class="settings-content">
          {#key current.id}
            <div class="settings-page" data-settings-current={current.id}>
              <current.body />
            </div>
          {/key}
        </div>
      </main>
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
    padding: 24px;
  }

  .settings-backdrop {
    position: absolute;
    inset: 0;
    border: 0;
    background: rgb(0 0 0 / 52%);
    cursor: default;
  }

  .settings-window {
    position: relative;
    display: grid;
    width: min(960px, 100%);
    height: min(700px, 100%);
    grid-template-columns: 216px minmax(0, 1fr);
    overflow: hidden;
    border: 1px solid var(--settings-line-strong);
    border-radius: 14px;
    background: var(--bg-panel);
    box-shadow: 0 24px 70px rgb(0 0 0 / 55%), 0 2px 8px rgb(0 0 0 / 30%);
    color: var(--text);
  }

  .settings-sidebar {
    display: flex;
    min-height: 0;
    flex-direction: column;
    gap: 14px;
    padding: 20px 12px 14px;
    border-right: 1px solid var(--settings-line);
    background: color-mix(in srgb, var(--bg-panel) 82%, #000);
  }

  h1 {
    margin: 0;
    padding: 0 10px;
    font-size: 15px;
    font-weight: 600;
  }

  .settings-nav {
    display: grid;
    gap: 2px;
  }

  .settings-nav-item {
    display: flex;
    height: 36px;
    align-items: center;
    gap: 11px;
    padding: 0 10px;
    border: 0;
    border-radius: 8px;
    background: transparent;
    color: var(--text-dim);
    font: inherit;
    font-size: 13px;
    text-align: left;
    cursor: pointer;
    transition: background-color var(--motion-quick) ease-out, color var(--motion-quick) ease-out;
  }

  .settings-nav-item svg {
    width: 17px;
    height: 17px;
    flex: 0 0 auto;
    fill: none;
    stroke: currentColor;
    stroke-linecap: round;
    stroke-linejoin: round;
    stroke-width: 1.35;
  }

  .settings-nav-item:hover {
    background: var(--settings-fill);
    color: var(--text);
  }

  /* Mixed with the text colour, so a pale accent (Light, Sky Blue) still reads on a light sidebar. */
  .settings-nav-item[aria-current="page"] {
    background: color-mix(in srgb, var(--accent) 18%, var(--settings-fill-hover));
    color: var(--text);
  }

  .settings-nav-item[aria-current="page"] svg {
    color: color-mix(in srgb, var(--accent) 72%, var(--text));
  }

  .settings-nav-item:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: -2px;
  }

  .settings-sidebar-footer {
    display: grid;
    gap: 3px;
    margin-top: auto;
    padding: 0 10px;
  }

  .sidebar-profile {
    overflow: hidden;
    color: var(--text-dim);
    font-size: 11.5px;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .app-version {
    color: var(--text-dim);
    font-family: var(--mono-font);
    font-size: 11px;
    opacity: 0.75;
    user-select: text;
  }

  .settings-main {
    display: flex;
    min-width: 0;
    min-height: 0;
    flex-direction: column;
  }

  .settings-page-header {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 16px;
    padding: 26px 24px 18px 36px;
    border-bottom: 1px solid var(--settings-line);
  }

  .settings-content {
    min-height: 0;
    flex: 1;
    overflow: auto;
    padding: 24px 36px 40px;
    scrollbar-color: color-mix(in srgb, var(--text) 22%, transparent) transparent;
    scrollbar-gutter: stable;
    scrollbar-width: thin;
  }

  .settings-close {
    display: grid;
    width: 30px;
    height: 30px;
    flex: 0 0 auto;
    place-items: center;
    padding: 0;
    border: 1px solid transparent;
    border-radius: 8px;
    background: transparent;
    color: var(--text-dim);
    font: inherit;
    font-size: 18px;
    line-height: 1;
    cursor: pointer;
  }

  .settings-close:hover,
  .settings-close:focus-visible {
    border-color: var(--settings-line-strong);
    background: var(--bg-panel-raised);
    color: var(--text);
  }

  @media (max-width: 720px) {
    .settings-window { grid-template-columns: 60px minmax(0, 1fr); }
    .settings-sidebar { padding-inline: 8px; }
    h1, .settings-nav-item span, .settings-sidebar-footer { display: none; }
    .settings-nav-item { justify-content: center; padding: 0; }
    .settings-content { padding: 20px 20px 32px; }
    .settings-page-header { padding: 22px 16px 14px 20px; }
  }
</style>
