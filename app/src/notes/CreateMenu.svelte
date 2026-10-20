<script lang="ts">
  import { onMount, tick } from "svelte";
  import { isTauri } from "@tauri-apps/api/core";
  import { camera, viewport } from "../board/camera.svelte";
  import { createNoteKind, createTaskNote } from "./noteCommands";
  import { creationMenu, closeCreationMenu, toggleCreationMenuPin } from "./creation.svelte";
  import { boardPopupStyle, dismissBoardPopup, fitBoardPopupAnchor, screenAnchoredPopupStyle } from "../ui/boardAnchor";
  import { tool } from "../tools/tool.svelte";
  import { cancelLineDraft } from "../links/interaction.svelte";
  import { clearSelectedLink } from "../links/selection.svelte";
  import { pickImageFiles, reportImportError } from "../attachments/service";
  import { importImagePaths } from "../images/imageActions";
  import { pickFormatFiles } from "../formats/formatActions";
  import { chooseAudioFile, importAudioFileFromBrowser, startAudioRecordingAt } from "../audio/audioActions";
  import { importVideoFiles, importVideoPaths, pickVideoFiles } from "../video/import";
  import { createYouTubeNote } from "../youtube/actions.svelte";
  import { parseYouTubeUrl } from "../youtube/logic";
  import { isTextEditingTarget } from "../commands/focus";
  import CreateItemIcon from "./CreateItemIcon.svelte";
  import {
    CREATE_CATEGORIES,
    CREATE_ITEMS,
    isStarrable,
    searchCreateItems,
    visibleRecentCreateItems,
    type CreateCategoryId,
    type CreateItemId,
  } from "./createMenuCatalog";
  import {
    createMenuPreferences,
    isStarredCreateItem,
    recordCreatedItem,
    toggleStarredCreateItem,
  } from "./createMenuPreferences.svelte";
  import { t } from "../i18n/i18n.svelte";

  const MENU_WIDTH = 200;
  const FLYOUT_WIDTH = 196;
  /** Hover intent: moving across other tabs on the way to an open flyout must not switch it. */
  const SWITCH_DELAY_MS = 140;
  const CLOSE_DELAY_MS = 320;

  type Entry = { kind: "item"; id: CreateItemId } | { kind: "tab"; id: CreateCategoryId };

  let menuElement = $state<HTMLElement | null>(null);
  let flyoutElement = $state<HTMLElement | null>(null);
  let searchInput = $state<HTMLInputElement | null>(null);
  let audioFileInput = $state<HTMLInputElement | null>(null);
  let videoFileInput = $state<HTMLInputElement | null>(null);
  let youtubeInputOpen = $state(false);
  let youtubeUrlDraft = $state("");
  let youtubeInputError = $state("");

  let openCategory = $state<CreateCategoryId | null>(null);
  let flyoutSide = $state<"right" | "left">("right");
  let flyoutTop = $state(0);
  let query = $state("");
  /** Keyboard focus: an entry of the main column, or an item of the open flyout. */
  let active = $state<{ zone: "main" | "flyout"; key: string } | null>(null);
  let switchTimer = 0;
  let closeTimer = 0;

  const tabElements: Partial<Record<CreateCategoryId, HTMLElement>> = {};

  let starred = $derived(createMenuPreferences.starred);
  let recent = $derived(visibleRecentCreateItems(createMenuPreferences));
  let results = $derived(searchCreateItems(query));
  let searching = $derived(query.trim().length > 0);
  let flyoutItems = $derived(CREATE_CATEGORIES.find((category) => category.id === openCategory)?.items ?? []);
  let mainEntries = $derived<Entry[]>(searching
    ? results.map((id) => ({ kind: "item" as const, id }))
    : [
      { kind: "item" as const, id: "note" as const },
      ...starred.map((id) => ({ kind: "item" as const, id })),
      ...recent.map((id) => ({ kind: "item" as const, id })),
      ...CREATE_CATEGORIES.map((category) => ({ kind: "tab" as const, id: category.id })),
    ]);

  // The menu height changes with starred/recent items: refit it so its bottom stays on screen.
  $effect(() => {
    void starred.length;
    void recent.length;
    void results.length;
    if (!creationMenu.open || creationMenu.pinned || !menuElement) return;
    const height = menuElement.offsetHeight;
    creationMenu.menuAnchor = fitBoardPopupAnchor(camera, viewport, creationMenu.origin, { width: MENU_WIDTH, height });
  });

  // Reset transient state whenever the menu opens again.
  $effect(() => {
    if (creationMenu.open) return;
    openCategory = null;
    query = "";
    active = null;
    closeYouTubeInput();
  });

  // Keep the flyout inside the window vertically.
  $effect(() => {
    void openCategory;
    if (!flyoutElement || !menuElement) return;
    const rect = flyoutElement.getBoundingClientRect();
    const scale = rect.height / Math.max(1, flyoutElement.offsetHeight);
    const overflow = rect.bottom - (window.innerHeight - 8);
    if (overflow > 0) flyoutTop = Math.max(-menuElement.offsetTop, flyoutTop - overflow / scale);
  });

  const menuStyle = $derived(creationMenu.pinned
    ? screenAnchoredPopupStyle(creationMenu.pinnedScreenAnchor)
    : boardPopupStyle(camera, viewport, creationMenu.menuAnchor, creationMenu.zoomAtOpen));

  // ---------- creating ----------

  function finishCreation(id: CreateItemId): void {
    recordCreatedItem(id);
    switchToSelectToolAfterCreation();
    if (!creationMenu.pinned) closeCreationMenu();
    else {
      openCategory = null;
      query = "";
    }
  }

  function runItem(id: CreateItemId): void {
    clearTimers();
    switch (id) {
      case "note": createNoteKind("note"); finishCreation(id); return;
      case "task": createTaskNote(); finishCreation(id); return;
      case "image": void createImagesFromMenu(); return;
      case "pdf": void createFromFormatPicker("pdf", id); return;
      case "format": void createFromFormatPicker("text", id); return;
      case "audio": void createAudioFromMenu(); return;
      case "record-audio": if (startAudioRecordingAt(creationMenu.origin)) finishCreation(id); return;
      case "video": void createVideoFromMenu(); return;
      case "youtube": openYouTubeInput(); return;
      default: createNoteKind(id); finishCreation(id);
    }
  }

  async function createImagesFromMenu(): Promise<void> {
    let paths: string[];
    try {
      paths = await pickImageFiles();
    } catch (error) {
      reportImportError(error instanceof Error ? error.message : String(error));
      return;
    }
    if (paths.length === 0) return;
    if (await importImagePaths(paths, { x: camera.x, y: camera.y })) finishCreation("image");
  }

  async function createFromFormatPicker(kind: "pdf" | "text", id: CreateItemId): Promise<void> {
    if (await pickFormatFiles(kind, { ...creationMenu.origin })) finishCreation(id);
  }

  async function createAudioFromMenu(): Promise<void> {
    if (!isTauri()) {
      audioFileInput?.click();
      return;
    }
    if (await chooseAudioFile(creationMenu.origin)) finishCreation("audio");
  }

  async function handleAudioFileInput(event: Event): Promise<void> {
    if (!(event.currentTarget instanceof HTMLInputElement)) return;
    const file = event.currentTarget.files?.[0];
    event.currentTarget.value = "";
    if (!file) return;
    if (await importAudioFileFromBrowser(file, creationMenu.origin)) finishCreation("audio");
  }

  async function createVideoFromMenu(): Promise<void> {
    if (!isTauri()) {
      videoFileInput?.click();
      return;
    }
    const paths = await pickVideoFiles();
    if (paths.length === 0) return;
    if ((await importVideoPaths(paths, creationMenu.origin)).length > 0) finishCreation("video");
  }

  async function handleVideoFileInput(event: Event): Promise<void> {
    if (!(event.currentTarget instanceof HTMLInputElement)) return;
    const files = [...(event.currentTarget.files ?? [])];
    event.currentTarget.value = "";
    if (files.length === 0) return;
    if ((await importVideoFiles(files, creationMenu.origin)).length > 0) finishCreation("video");
  }

  function openYouTubeInput(): void {
    openCategory = null;
    query = "";
    youtubeInputOpen = true;
    youtubeInputError = "";
  }

  function closeYouTubeInput(): void {
    youtubeInputOpen = false;
    youtubeUrlDraft = "";
    youtubeInputError = "";
  }

  function handleYouTubeInputKeydown(event: KeyboardEvent): void {
    event.stopPropagation();
    if (event.key === "Enter") {
      event.preventDefault();
      createYouTubeFromMenu();
    } else if (event.key === "Escape") {
      event.preventDefault();
      closeYouTubeInput();
    }
  }

  function createYouTubeFromMenu(): void {
    const parsed = parseYouTubeUrl(youtubeUrlDraft);
    if (parsed.kind !== "youtube") {
      youtubeInputError = parsed.kind === "invalid" ? parsed.error : t("Enter a YouTube video URL.");
      return;
    }
    createYouTubeNote(parsed.ref, creationMenu.origin);
    closeYouTubeInput();
    finishCreation("youtube");
  }

  function switchToSelectToolAfterCreation(): void {
    if (tool.active !== "zone" && tool.active !== "line-strong" && tool.active !== "line-weak") return;
    tool.active = "select";
    cancelLineDraft();
    clearSelectedLink();
  }

  function toggleStar(event: MouseEvent, id: CreateItemId): void {
    event.preventDefault();
    event.stopPropagation();
    toggleStarredCreateItem(id);
  }

  // ---------- flyouts ----------

  function clearTimers(): void {
    window.clearTimeout(switchTimer);
    window.clearTimeout(closeTimer);
  }

  function openFlyout(id: CreateCategoryId): void {
    clearTimers();
    const tab = tabElements[id];
    if (!tab || !menuElement) return;
    const rect = menuElement.getBoundingClientRect();
    const scale = rect.width / Math.max(1, menuElement.offsetWidth);
    flyoutSide = rect.right + (FLYOUT_WIDTH + 8) * scale <= window.innerWidth || rect.left - (FLYOUT_WIDTH + 8) * scale < 0 ? "right" : "left";
    flyoutTop = tab.offsetTop - 5;
    openCategory = id;
  }

  function hoverTab(id: CreateCategoryId): void {
    window.clearTimeout(closeTimer);
    window.clearTimeout(switchTimer);
    if (openCategory === id) return;
    if (openCategory === null) openFlyout(id);
    else switchTimer = window.setTimeout(() => openFlyout(id), SWITCH_DELAY_MS);
  }

  function hoverOutsideTabs(): void {
    window.clearTimeout(switchTimer);
    if (openCategory !== null) switchTimer = window.setTimeout(() => { openCategory = null; }, SWITCH_DELAY_MS);
  }

  function enterFlyout(): void {
    clearTimers();
  }

  function leaveMenu(): void {
    window.clearTimeout(closeTimer);
    closeTimer = window.setTimeout(() => {
      openCategory = null;
      if (active?.zone === "flyout") active = null;
    }, CLOSE_DELAY_MS);
  }

  function tabRef(element: HTMLElement, id: CreateCategoryId): { destroy(): void } {
    tabElements[id] = element;
    return { destroy() { if (tabElements[id] === element) delete tabElements[id]; } };
  }

  // ---------- keyboard ----------

  function entryKey(entry: Entry): string {
    return `${entry.kind}:${entry.id}`;
  }

  function moveActive(step: number): void {
    if (active?.zone === "flyout" && openCategory) {
      const index = flyoutItems.findIndex((id) => `item:${id}` === active?.key);
      const next = flyoutItems[(index + step + flyoutItems.length) % flyoutItems.length];
      if (next) active = { zone: "flyout", key: `item:${next}` };
      return;
    }
    const keys = mainEntries.map(entryKey);
    if (keys.length === 0) return;
    const index = active ? keys.indexOf(active.key) : -1;
    const next = keys[index < 0 ? (step > 0 ? 0 : keys.length - 1) : (index + step + keys.length) % keys.length];
    active = { zone: "main", key: next };
    if (next.startsWith("tab:")) openFlyout(next.slice(4) as CreateCategoryId);
    else if (!searching) openCategory = null;
  }

  function enterFlyoutWithKeyboard(id: CreateCategoryId): void {
    openFlyout(id);
    const first = CREATE_CATEGORIES.find((category) => category.id === id)?.items[0];
    if (first) active = { zone: "flyout", key: `item:${first}` };
  }

  function activateCurrent(): void {
    if (!active) {
      const first = searching ? results[0] : undefined;
      if (first) runItem(first);
      return;
    }
    const [kind, id] = active.key.split(":") as ["item" | "tab", string];
    if (kind === "tab") enterFlyoutWithKeyboard(id as CreateCategoryId);
    else runItem(id as CreateItemId);
  }

  function menuHasFocus(): boolean {
    return Boolean(menuElement && document.activeElement && menuElement.contains(document.activeElement));
  }

  function startSearch(text: string): void {
    openCategory = null;
    query = text;
    active = null;
    void tick().then(() => {
      searchInput?.focus();
      const end = searchInput?.value.length ?? 0;
      searchInput?.setSelectionRange(end, end);
    });
  }

  function onWindowKeyDown(event: KeyboardEvent): void {
    if (!creationMenu.open || event.defaultPrevented || youtubeInputOpen) return;
    const inSearch = event.target === searchInput;
    if (!inSearch && isTextEditingTarget(event.target)) return;
    // A pinned list stays open while the user works on the board: it takes keys only when focused.
    if (creationMenu.pinned && !menuHasFocus()) return;
    if (event.ctrlKey || event.metaKey || event.altKey) return;

    const consume = () => { event.preventDefault(); event.stopImmediatePropagation(); };
    switch (event.key) {
      case "ArrowDown": consume(); moveActive(1); return;
      case "ArrowUp": consume(); moveActive(-1); return;
      case "ArrowRight":
        if (inSearch || active?.zone !== "main" || !active.key.startsWith("tab:")) return;
        consume(); enterFlyoutWithKeyboard(active.key.slice(4) as CreateCategoryId); return;
      case "ArrowLeft":
        if (inSearch || active?.zone !== "flyout" || !openCategory) return;
        consume(); active = { zone: "main", key: `tab:${openCategory}` }; return;
      case "Enter": consume(); activateCurrent(); return;
      case "Escape":
        consume();
        if (searching) { query = ""; active = null; searchInput?.blur(); }
        else if (openCategory) { openCategory = null; if (active?.zone === "flyout") active = null; }
        else closeCreationMenu();
        return;
    }
    if (inSearch) return;
    if (/^[1-6]$/.test(event.key) && !searching) {
      const category = CREATE_CATEGORIES[Number(event.key) - 1];
      if (category) { consume(); active = { zone: "main", key: `tab:${category.id}` }; enterFlyoutWithKeyboard(category.id); }
      return;
    }
    // Type to search. Q is left alone so it still closes the list.
    if (event.key.length === 1 && /\p{L}/u.test(event.key) && event.code !== "KeyQ") {
      consume();
      startSearch(event.key);
    }
  }

  onMount(() => {
    window.addEventListener("keydown", onWindowKeyDown, true);
    return () => {
      window.removeEventListener("keydown", onWindowKeyDown, true);
      clearTimers();
    };
  });
</script>

{#snippet itemRow(id: CreateItemId, zone: "main" | "flyout", extraClass = "")}
  {@const starredNow = isStarredCreateItem(id)}
  <div
    class={`create-row ${extraClass}`}
    class:active={active?.zone === zone && active.key === `item:${id}`}
    data-create-kind={id}
  >
    <button class="create-item" type="button" onclick={() => runItem(id)} onmouseenter={() => { if (zone === "main") hoverOutsideTabs(); }}>
      <CreateItemIcon {id} />
      <span class="item-label">{CREATE_ITEMS[id].label}</span>
    </button>
    {#if isStarrable(id)}
      <button
        class="star-toggle"
        class:starred={starredNow}
        type="button"
        data-create-star={id}
        aria-pressed={starredNow}
        aria-label={starredNow ? t("Unstar {label}", { label: CREATE_ITEMS[id].label }) : t("Star {label} (show at the top)", { label: CREATE_ITEMS[id].label })}
        title={starredNow ? t("Remove from the top") : t("Star: show at the top, next to Note")}
        onclick={(event) => toggleStar(event, id)}
      >
        <svg viewBox="0 0 16 16" aria-hidden="true"><path d="m8 2.2 1.8 3.7 4 .6-2.9 2.8.7 4L8 11.4l-3.6 1.9.7-4-2.9-2.8 4-.6z" /></svg>
      </button>
    {/if}
  </div>
{/snippet}

{#if creationMenu.open}
  <aside
    bind:this={menuElement}
    class="create-menu"
    data-create-menu
    data-selection-ignore
    aria-label={t("Create list")}
    style={menuStyle}
    use:dismissBoardPopup={{ close: closeCreationMenu, escape: false, shouldDismissOutside: () => !creationMenu.pinned }}
    onmouseleave={leaveMenu}
    onmouseenter={() => window.clearTimeout(closeTimer)}
  >
    <header class="menu-header">
      <label class="search">
        <svg viewBox="0 0 16 16" aria-hidden="true"><circle cx="7" cy="7" r="4.2" /><path d="m10.2 10.2 3.3 3.3" /></svg>
        <input
          bind:this={searchInput}
          bind:value={query}
          data-create-search
          type="text"
          placeholder={t("Create…")}
          aria-label={t("Search what to create")}
          spellcheck="false"
          autocomplete="off"
          oninput={() => { openCategory = null; active = null; }}
        />
      </label>
      <div class="menu-actions">
        <button
          class="menu-action pin-button"
          type="button"
          aria-label={creationMenu.pinned ? t("Unpin create list") : t("Pin create list")}
          aria-pressed={creationMenu.pinned}
          title={creationMenu.pinned ? t("Unpin list") : t("Keep list open after creating")}
          onclick={toggleCreationMenuPin}
        >
          <svg viewBox="0 0 16 16" aria-hidden="true">
            <path d="M5 2.5h6l-.8 3 2.3 2.2v1H3.5v-1l2.3-2.2zM8 8.7v4.8" />
          </svg>
        </button>
        <button class="menu-action close-button" type="button" aria-label={t("Close create list")} title={t("Close")} onclick={closeCreationMenu}>
          <svg viewBox="0 0 16 16" aria-hidden="true"><path d="m4 4 8 8M12 4l-8 8" /></svg>
        </button>
      </div>
    </header>

    {#if youtubeInputOpen}
      <div class="youtube-create-input" data-youtube-create>
        <span class="youtube-create-title"><CreateItemIcon id="youtube" /> {t("YouTube link")}</span>
        <!-- svelte-ignore a11y_autofocus -->
        <input
          bind:value={youtubeUrlDraft}
          data-youtube-url-input
          type="url"
          placeholder={t("Paste a YouTube URL")}
          aria-label={t("YouTube video URL")}
          aria-invalid={youtubeInputError ? "true" : undefined}
          autofocus
          onkeydown={handleYouTubeInputKeydown}
        />
        {#if youtubeInputError}<span class="youtube-create-error" role="alert">{youtubeInputError}</span>{/if}
        <div class="youtube-create-actions">
          <button type="button" onclick={closeYouTubeInput}>{t("Cancel")}</button>
          <button type="button" class="primary" onclick={createYouTubeFromMenu}>{t("Create")}</button>
        </div>
      </div>
    {:else if searching}
      <div class="create-section results" role="listbox" aria-label={t("Search results")}>
        {#each results as id (id)}
          {@render itemRow(id, "main")}
        {:else}
          <p class="empty">{t("Nothing matches “{query}”", { query: query.trim() })}</p>
        {/each}
      </div>
    {:else}
      <div class="create-section top">
        {@render itemRow("note", "main", "note-row")}
        {#each starred as id (id)}
          {@render itemRow(id, "main", "starred-row")}
        {/each}
      </div>

      {#if recent.length > 0}
        <div class="create-section recent">
          <span class="section-label">{t("Recent")}</span>
          {#each recent as id (id)}
            {@render itemRow(id, "main", "recent-row")}
          {/each}
        </div>
      {/if}

      <nav class="create-section tabs" aria-label={t("Node categories")}>
        {#each CREATE_CATEGORIES as category, index (category.id)}
          <button
            use:tabRef={category.id}
            class="create-tab"
            class:open={openCategory === category.id}
            class:active={active?.zone === "main" && active.key === `tab:${category.id}`}
            type="button"
            data-create-category={category.id}
            aria-haspopup="menu"
            aria-expanded={openCategory === category.id}
            onmouseenter={() => hoverTab(category.id)}
            onclick={() => (openCategory === category.id ? (openCategory = null) : openFlyout(category.id))}
          >
            <CreateItemIcon id={category.id} />
            <span class="item-label">{category.label}</span>
            <kbd>{index + 1}</kbd>
            <svg class="chevron" viewBox="0 0 16 16" aria-hidden="true"><path d="m6 3.5 4.5 4.5L6 12.5" /></svg>
          </button>
        {/each}
      </nav>

      {#if openCategory}
        <div
          bind:this={flyoutElement}
          class="create-flyout"
          class:left={flyoutSide === "left"}
          style:top={`${flyoutTop}px`}
          role="menu"
          tabindex="-1"
          aria-label={CREATE_CATEGORIES.find((category) => category.id === openCategory)?.label}
          data-create-flyout={openCategory}
          onmouseenter={enterFlyout}
        >
          {#each flyoutItems as id (id)}
            {@render itemRow(id, "flyout")}
          {/each}
        </div>
      {/if}
    {/if}

    <input
      bind:this={videoFileInput}
      hidden
      type="file"
      accept="video/mp4,video/webm,.mp4,.webm"
      multiple
      tabindex="-1"
      aria-label={t("Choose video files")}
      onchange={handleVideoFileInput}
    />
    <input
      bind:this={audioFileInput}
      hidden
      type="file"
      accept="audio/mpeg,audio/wav,audio/ogg,audio/webm,audio/mp4,audio/flac,.mp3,.wav,.ogg,.oga,.webm,.weba,.m4a,.m4b,.mka,.flac"
      tabindex="-1"
      aria-label={t("Choose an audio file")}
      onchange={handleAudioFileInput}
    />
  </aside>
{/if}

<style>
  .create-menu {
    position: absolute;
    z-index: 30;
    width: 200px;
    color: var(--text);
    background: var(--bg-panel);
    border: 1px solid #4b4b4b;
    border-radius: 7px;
    box-shadow: 0 10px 28px rgb(0 0 0 / 45%), 0 1px 0 rgb(255 255 255 / 4%) inset;
    font-size: 12px;
  }

  .menu-header {
    display: flex;
    height: 34px;
    align-items: center;
    gap: 4px;
    padding: 0 5px 0 6px;
    border-bottom: 1px solid #3c3c3c;
  }

  .search {
    display: flex;
    min-width: 0;
    flex: 1;
    align-items: center;
    gap: 5px;
    height: 24px;
    padding: 0 6px;
    border-radius: 4px;
    color: var(--text-dim);
  }

  .search:focus-within {
    background: var(--bg-panel-raised);
    box-shadow: 0 0 0 1px #4a4a4a inset;
  }

  .search svg {
    width: 13px;
    height: 13px;
    flex: 0 0 auto;
    fill: none;
    stroke: var(--icon);
    stroke-linecap: round;
    stroke-width: 1.4;
    opacity: 0.75;
  }

  .search input {
    min-width: 0;
    width: 100%;
    padding: 0;
    color: var(--text);
    background: transparent;
    border: 0;
    outline: none;
    font: inherit;
    font-weight: 600;
  }

  .search input::placeholder {
    color: var(--text-dim);
    font-weight: 600;
  }

  .menu-actions {
    display: flex;
    align-items: center;
    gap: 1px;
  }

  .menu-action {
    display: grid;
    width: 22px;
    height: 22px;
    place-items: center;
    padding: 0;
    color: var(--text-dim);
    background: transparent;
    border: 1px solid transparent;
    border-radius: 4px;
    cursor: pointer;
  }

  .menu-action:hover,
  .menu-action[aria-pressed="true"] {
    color: var(--text);
    background: var(--bg-hover);
    border-color: #4a4a4a;
  }

  .menu-action svg {
    width: 14px;
    height: 14px;
    fill: none;
    stroke: var(--icon);
    stroke-linecap: round;
    stroke-linejoin: round;
    stroke-width: 1.35;
  }

  .create-section {
    display: flex;
    flex-direction: column;
    gap: 1px;
    padding: 4px;
  }

  .create-section + .create-section {
    border-top: 1px solid #383838;
  }

  .top {
    max-height: 290px;
    overflow-y: auto;
  }

  .results {
    max-height: 360px;
    overflow-y: auto;
  }

  .section-label {
    padding: 3px 8px 2px;
    color: var(--text-dim);
    font-size: 10px;
    font-weight: 600;
    letter-spacing: 0.04em;
    text-transform: uppercase;
  }

  .create-row {
    position: relative;
    display: flex;
    align-items: center;
    border-radius: 5px;
  }

  .create-row:hover,
  .create-row.active,
  .create-tab:hover,
  .create-tab.open,
  .create-tab.active {
    background: var(--bg-hover);
  }

  .create-row.active,
  .create-tab.active {
    box-shadow: 0 0 0 1px color-mix(in srgb, var(--accent) 70%, transparent) inset;
  }

  .create-item,
  .create-tab {
    display: flex;
    min-width: 0;
    flex: 1;
    min-height: 28px;
    align-items: center;
    gap: 9px;
    padding: 0 8px;
    color: inherit;
    text-align: left;
    background: transparent;
    border: 0;
    border-radius: 5px;
    font: inherit;
    cursor: pointer;
  }

  .item-label {
    min-width: 0;
    flex: 1;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .note-row .create-item {
    min-height: 34px;
    font-size: 13px;
    font-weight: 650;
  }

  .note-row :global(.create-icon) {
    width: 18px;
    height: 18px;
  }

  .star-toggle {
    display: grid;
    width: 24px;
    height: 24px;
    flex: 0 0 auto;
    place-items: center;
    margin-right: 2px;
    padding: 0;
    background: transparent;
    border: 0;
    border-radius: 4px;
    cursor: pointer;
    opacity: 0;
    transition: opacity 90ms ease-out;
  }

  .create-row:hover .star-toggle,
  .create-row.active .star-toggle,
  .star-toggle:focus-visible,
  .star-toggle.starred {
    opacity: 1;
  }

  .star-toggle svg {
    width: 13px;
    height: 13px;
    fill: none;
    stroke: var(--text-dim);
    stroke-linejoin: round;
    stroke-width: 1.2;
  }

  .star-toggle:hover svg {
    stroke: #f1c85b;
  }

  .star-toggle.starred svg {
    fill: #f1c85b;
    stroke: #f1c85b;
  }

  /* In the top list the star is the unstar handle: quiet until hovered. */
  .starred-row .star-toggle.starred {
    opacity: 0.55;
  }

  .starred-row:hover .star-toggle.starred {
    opacity: 1;
  }

  .tabs {
    padding-bottom: 5px;
  }

  .create-tab kbd {
    min-width: 14px;
    color: var(--text-dim);
    font: inherit;
    font-size: 10px;
    text-align: center;
    opacity: 0.6;
  }

  .chevron {
    width: 12px;
    height: 12px;
    flex: 0 0 auto;
    fill: none;
    stroke: var(--text-dim);
    stroke-linecap: round;
    stroke-linejoin: round;
    stroke-width: 1.4;
  }

  .create-tab.open .chevron {
    stroke: var(--text);
  }

  .create-flyout {
    position: absolute;
    left: calc(100% + 4px);
    display: flex;
    width: 196px;
    flex-direction: column;
    gap: 1px;
    padding: 4px;
    background: var(--bg-panel);
    border: 1px solid #4b4b4b;
    border-radius: 7px;
    box-shadow: 0 10px 28px rgb(0 0 0 / 45%);
    animation: flyout-in 110ms ease-out;
  }

  /* An invisible bridge over the gap so the pointer never "falls" between menu and flyout. */
  .create-flyout::before {
    position: absolute;
    top: 0;
    bottom: 0;
    left: -6px;
    width: 6px;
    content: "";
  }

  .create-flyout.left {
    right: calc(100% + 4px);
    left: auto;
    animation-name: flyout-in-left;
  }

  .create-flyout.left::before {
    right: -6px;
    left: auto;
  }

  @keyframes flyout-in {
    from { opacity: 0; transform: translateX(-4px); }
  }

  @keyframes flyout-in-left {
    from { opacity: 0; transform: translateX(4px); }
  }

  @media (prefers-reduced-motion: reduce) {
    .create-flyout { animation: none; }
  }

  .empty {
    margin: 0;
    padding: 10px 8px;
    color: var(--text-dim);
    font-size: 11px;
  }

  .youtube-create-input {
    display: grid;
    gap: 6px;
    padding: 8px;
  }

  .youtube-create-title {
    display: flex;
    align-items: center;
    gap: 7px;
    font-weight: 600;
  }

  .youtube-create-input input {
    box-sizing: border-box;
    width: 100%;
    min-width: 0;
    padding: 6px;
    border: 1px solid var(--border);
    border-radius: 4px;
    color: var(--text);
    background: var(--bg-panel-raised);
    font: inherit;
    font-size: 11px;
  }

  .youtube-create-error {
    color: #e59a94;
    font-size: 10px;
    overflow-wrap: anywhere;
  }

  .youtube-create-actions {
    display: flex;
    justify-content: flex-end;
    gap: 4px;
  }

  .youtube-create-actions button {
    padding: 4px 9px;
    border: 1px solid var(--border);
    border-radius: 4px;
    color: var(--text);
    background: var(--bg-panel-raised);
    font: inherit;
    font-size: 11px;
    cursor: pointer;
  }

  .youtube-create-actions button.primary {
    border-color: color-mix(in srgb, var(--accent) 60%, var(--border));
  }
</style>
