<script lang="ts">
  import { isTauri } from "@tauri-apps/api/core";
  import { camera, viewport } from "../board/camera.svelte";
  import { createNote, createNoteKind } from "./noteCommands";
  import { R5_KINDS, R6_KINDS, R7_KINDS } from "../model/note";
  import { creationMenu, closeCreationMenu, toggleCreationMenuPin } from "./creation.svelte";
  import { boardPopupStyle, dismissBoardPopup, fitBoardPopupAnchor, screenAnchoredPopupStyle } from "../ui/boardAnchor";
  import { tool } from "../tools/tool.svelte";
  import { cancelLineDraft } from "../links/interaction.svelte";
  import { clearSelectedLink } from "../links/selection.svelte";
  import { pickImageFiles, reportImportError } from "../attachments/service";
  import { importImagePaths } from "../images/imageActions";
  import { pickFormatFiles } from "../formats/formatActions";
  import { chooseAudioFile, importAudioFileFromBrowser, startAudioRecordingAt } from "../audio/audioActions";
  import { importVideoPaths, pickVideoFiles } from "../video/import";
  import { createYouTubeNote } from "../youtube/actions.svelte";
  import { parseYouTubeUrl } from "../youtube/logic";

  let menuElement = $state<HTMLElement | null>(null);
  let audioFileInput = $state<HTMLInputElement | null>(null);
  let youtubeInputOpen = $state(false);
  let youtubeUrlDraft = $state("");
  let youtubeInputError = $state("");

  // The menu grew past the height assumed at open time (R7/R8 kinds): measure it once it is on
  // screen and refit, so its bottom items are never outside the window.
  $effect(() => {
    if (!creationMenu.open || creationMenu.pinned || !menuElement) return;
    const height = menuElement.offsetHeight;
    creationMenu.menuAnchor = fitBoardPopupAnchor(camera, viewport, creationMenu.origin, { width: 164, height });
  });

  const menuStyle = $derived(creationMenu.pinned
    ? screenAnchoredPopupStyle(creationMenu.pinnedScreenAnchor)
    : boardPopupStyle(camera, viewport, creationMenu.menuAnchor, creationMenu.zoomAtOpen));

  function createNoteFromMenu(): void {
    createNote();
    switchToSelectToolAfterCreation();
    if (!creationMenu.pinned) closeCreationMenu();
  }

  function createMiniNodeFromMenu(kind: "pro" | "con"): void {
    createNoteKind(kind);
    switchToSelectToolAfterCreation();
    if (!creationMenu.pinned) closeCreationMenu();
  }

  function createModuleFromMenu(kind: "importance" | "purpose" | "mood"): void {
    createNoteKind(kind);
    switchToSelectToolAfterCreation();
    if (!creationMenu.pinned) closeCreationMenu();
  }

  const R5_LABELS: Record<(typeof R5_KINDS)[number] | (typeof R6_KINDS)[number] | (typeof R7_KINDS)[number], string> = {
    inbox: "Inbox",
    list: "List",
    source: "Source",
    glossary: "Dictionary",
    map: "Map",
    random: "Random Choice",
    markas: "Mark as",
    archive: "Archive",
    trash: "Trash",
    goal: "Goal",
    progress: "Progress",
    calculator: "Calculator",
    tierlist: "Tierlist",
    stats: "Statistics",
  };

  function createR5FromMenu(kind: (typeof R5_KINDS)[number] | (typeof R6_KINDS)[number] | (typeof R7_KINDS)[number]): void {
    createNoteKind(kind);
    switchToSelectToolAfterCreation();
    if (!creationMenu.pinned) closeCreationMenu();
  }

  function createBeaconFromMenu(): void {
    createNoteKind("beacon");
    switchToSelectToolAfterCreation();
    if (!creationMenu.pinned) closeCreationMenu();
  }

  function createTimeFromMenu(): void {
    createNoteKind("time");
    switchToSelectToolAfterCreation();
    if (!creationMenu.pinned) closeCreationMenu();
  }

  function createCalendarFromMenu(): void {
    createNoteKind("calendar");
    switchToSelectToolAfterCreation();
    if (!creationMenu.pinned) closeCreationMenu();
  }

  function createMessageFromMenu(): void {
    createNoteKind("message");
    switchToSelectToolAfterCreation();
    if (!creationMenu.pinned) closeCreationMenu();
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
    const created = await importImagePaths(paths, { x: camera.x, y: camera.y });
    if (!created) return;
    switchToSelectToolAfterCreation();
    if (!creationMenu.pinned) closeCreationMenu();
  }

  async function createPdfFromMenu(): Promise<void> {
    const center = { ...creationMenu.origin };
    if (!(await pickFormatFiles("pdf", center))) return;
    switchToSelectToolAfterCreation();
    if (!creationMenu.pinned) closeCreationMenu();
  }

  async function createFormatFromMenu(): Promise<void> {
    const center = { ...creationMenu.origin };
    if (!(await pickFormatFiles("text", center))) return;
    switchToSelectToolAfterCreation();
    if (!creationMenu.pinned) closeCreationMenu();
  }

  async function createAudioFromMenu(): Promise<void> {
    if (!isTauri()) {
      audioFileInput?.click();
      return;
    }
    const created = await chooseAudioFile(creationMenu.origin);
    if (!created) return;
    switchToSelectToolAfterCreation();
    if (!creationMenu.pinned) closeCreationMenu();
  }

  async function handleAudioFileInput(event: Event): Promise<void> {
    if (!(event.currentTarget instanceof HTMLInputElement)) return;
    const file = event.currentTarget.files?.[0];
    event.currentTarget.value = "";
    if (!file) return;
    const created = await importAudioFileFromBrowser(file, creationMenu.origin);
    if (!created) return;
    switchToSelectToolAfterCreation();
    if (!creationMenu.pinned) closeCreationMenu();
  }

  function createRecordingFromMenu(): void {
    if (!startAudioRecordingAt(creationMenu.origin)) return;
    switchToSelectToolAfterCreation();
    if (!creationMenu.pinned) closeCreationMenu();
  }

  async function createVideoFromMenu(): Promise<void> {
    const paths = await pickVideoFiles();
    if (paths.length === 0) return;
    const created = await importVideoPaths(paths, creationMenu.origin);
    if (created.length === 0) return;
    switchToSelectToolAfterCreation();
    if (!creationMenu.pinned) closeCreationMenu();
  }

  function openYouTubeInput(): void {
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
      youtubeInputError = parsed.kind === "invalid" ? parsed.error : "Enter a YouTube video URL.";
      return;
    }
    createYouTubeNote(parsed.ref, creationMenu.origin);
    switchToSelectToolAfterCreation();
    if (!creationMenu.pinned) closeCreationMenu();
    closeYouTubeInput();
  }

  function switchToSelectToolAfterCreation(): void {
    if (tool.active !== "zone" && tool.active !== "line-strong" && tool.active !== "line-weak") return;
    tool.active = "select";
    cancelLineDraft();
    clearSelectedLink();
  }
</script>

{#if creationMenu.open}
  <aside
    bind:this={menuElement}
    style:max-height={`${Math.max(160, viewport.height - 16)}px`}
    class="create-menu"
    data-create-menu
    data-selection-ignore
    aria-label="Create list"
    style={menuStyle}
    use:dismissBoardPopup={{ close: closeCreationMenu, shouldDismissOutside: () => !creationMenu.pinned }}
  >
    <header class="menu-header">
      <span>Create</span>
      <div class="menu-actions">
        <button
          class="menu-action pin-button"
          type="button"
          aria-label={creationMenu.pinned ? "Unpin create list" : "Pin create list"}
          aria-pressed={creationMenu.pinned}
          title={creationMenu.pinned ? "Unpin list" : "Keep list open after creating"}
          onclick={toggleCreationMenuPin}
        >
          <svg viewBox="0 0 16 16" aria-hidden="true">
            <path d="M5 2.5h6l-.8 3 2.3 2.2v1H3.5v-1l2.3-2.2zM8 8.7v4.8" />
          </svg>
        </button>
        <button
          class="menu-action close-button"
          type="button"
          aria-label="Close create list"
          title="Close"
          onclick={closeCreationMenu}
        >
          <svg viewBox="0 0 16 16" aria-hidden="true">
            <path d="m4 4 8 8M12 4l-8 8" />
          </svg>
        </button>
      </div>
    </header>
    <div class="create-items">
      <button class="create-item" type="button" onclick={createNoteFromMenu}>
        <span class="note-icon" aria-hidden="true"></span>
        <span>Note</span>
      </button>
      <button class="create-item" type="button" onclick={() => createMiniNodeFromMenu("pro")}>
        <span class="kind-icon plus-icon" aria-hidden="true">+</span>
        <span>Plus</span>
      </button>
      <button class="create-item" type="button" onclick={() => createMiniNodeFromMenu("con")}>
        <span class="kind-icon minus-icon" aria-hidden="true">−</span>
        <span>Minus</span>
      </button>
      <button class="create-item" type="button" onclick={() => createModuleFromMenu("importance")}>
        <span class="module-icon importance-icon" aria-hidden="true"></span>
        <span>Importance</span>
      </button>
      <button class="create-item" type="button" onclick={() => createModuleFromMenu("purpose")}>
        <span class="module-icon purpose-icon" aria-hidden="true">
          <svg viewBox="0 0 16 16"><path d="M8 2.5 13.5 8 8 13.5 2.5 8zM8 5v6M5 8h6" /></svg>
        </span>
        <span>Purpose</span>
      </button>
      <button class="create-item" type="button" onclick={() => createModuleFromMenu("mood")}>
        <span class="module-icon mood-icon" aria-hidden="true"></span>
        <span>Mood</span>
      </button>
      <button class="create-item" type="button" onclick={createBeaconFromMenu}>
        <span class="beacon-icon" aria-hidden="true"></span>
        <span>Beacon</span>
      </button>
      {#each [...R5_KINDS, ...R6_KINDS, ...R7_KINDS] as kind (kind)}
        <button class="create-item" type="button" data-create-kind={kind} onclick={() => createR5FromMenu(kind)}>
          <span class="r5-icon" aria-hidden="true"></span>
          <span>{R5_LABELS[kind]}</span>
        </button>
      {/each}
      <button class="create-item" type="button" data-create-kind="time" onclick={createTimeFromMenu}>
        <span class="r5-icon time-icon" aria-hidden="true"></span>
        <span>Time</span>
      </button>
      <button class="create-item" type="button" data-create-kind="calendar" onclick={createCalendarFromMenu}>
        <span class="r5-icon calendar-icon" aria-hidden="true"></span>
        <span>Calendar</span>
      </button>
      <button class="create-item" type="button" data-create-kind="message" onclick={createMessageFromMenu}>
        <span class="r5-icon" aria-hidden="true"></span>
        <span>Message</span>
      </button>
      <button class="create-item" type="button" data-create-kind="image" onclick={createImagesFromMenu}>
        <span class="r5-icon image-icon" aria-hidden="true"></span>
        <span>Image…</span>
      </button>
      <button class="create-item" type="button" data-create-kind="pdf" onclick={createPdfFromMenu}>
        <span class="r5-icon pdf-icon" aria-hidden="true"></span>
        <span>PDF…</span>
      </button>
      <button class="create-item" type="button" data-create-kind="format" onclick={createFormatFromMenu}>
        <span class="r5-icon format-icon" aria-hidden="true"></span>
        <span>File…</span>
      </button>
      <button class="create-item" type="button" data-create-kind="audio" onclick={() => void createAudioFromMenu()}>
        <span class="r5-icon audio-icon" aria-hidden="true"></span>
        <span>Audio file…</span>
      </button>
      <button class="create-item" type="button" data-create-kind="record-audio" onclick={createRecordingFromMenu}>
        <span class="r5-icon record-audio-icon" aria-hidden="true"></span>
        <span>Record audio</span>
      </button>
      <button class="create-item" type="button" data-create-kind="video" onclick={() => void createVideoFromMenu()}>
        <span class="r5-icon video-icon" aria-hidden="true"></span>
        <span>Video file…</span>
      </button>
      {#if youtubeInputOpen}
        <div class="youtube-create-input" data-youtube-create>
          <input
            bind:value={youtubeUrlDraft}
            data-youtube-url-input
            type="url"
            placeholder="Paste a YouTube URL"
            aria-label="YouTube video URL"
            aria-invalid={youtubeInputError ? "true" : undefined}
            onkeydown={handleYouTubeInputKeydown}
          />
          {#if youtubeInputError}<span class="youtube-create-error" role="alert">{youtubeInputError}</span>{/if}
          <div class="youtube-create-actions">
            <button type="button" onclick={createYouTubeFromMenu}>Create</button>
            <button type="button" onclick={closeYouTubeInput}>Cancel</button>
          </div>
        </div>
      {:else}
        <button class="create-item" type="button" data-create-kind="youtube" onclick={openYouTubeInput}>
          <span class="r5-icon youtube-icon" aria-hidden="true"></span>
          <span>YouTube link…</span>
        </button>
      {/if}
      <input
        bind:this={audioFileInput}
        class="hidden-file-input"
        type="file"
        accept="audio/mpeg,audio/wav,audio/ogg,audio/webm,audio/mp4,audio/flac,.mp3,.wav,.ogg,.oga,.webm,.weba,.m4a,.m4b,.mka,.flac"
        tabindex="-1"
        aria-label="Choose an audio file"
        onchange={handleAudioFileInput}
      />
    </div>
  </aside>
{/if}

<style>
  .create-menu {
    position: absolute;
    z-index: 30;
    width: 164px;
    overflow-x: hidden;
    overflow-y: auto;
    color: var(--text);
    background: #282828;
    border: 1px solid #4b4b4b;
    border-radius: 4px;
    box-shadow: 0 6px 20px rgb(0 0 0 / 42%);
  }

  .menu-header {
    display: flex;
    height: 30px;
    align-items: center;
    justify-content: space-between;
    padding: 0 5px 0 9px;
    color: var(--text-dim);
    background: #222;
    border-bottom: 1px solid #414141;
    font-size: 11px;
    font-weight: 600;
  }

  .menu-actions {
    display: flex;
    align-items: center;
    gap: 2px;
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
    border-radius: 3px;
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
    stroke: currentColor;
    stroke-linecap: round;
    stroke-linejoin: round;
    stroke-width: 1.35;
  }

  .create-items {
    display: flex;
    flex-direction: column;
    gap: 2px;
    padding: 5px;
  }

  .create-item {
    display: flex;
    min-height: 30px;
    align-items: center;
    gap: 8px;
    padding: 0 7px;
    text-align: left;
    background: transparent;
    border: 1px solid transparent;
    border-radius: 3px;
    cursor: pointer;
  }

  .create-item:hover {
    background: var(--bg-hover);
    border-color: #4a4a4a;
  }

  .note-icon {
    width: 13px;
    height: 15px;
    background: #3a3a3a;
    border: 1px solid #929292;
    border-radius: 2px;
    box-shadow: inset 0 -3px 0 #303030;
  }

  .kind-icon {
    display: grid;
    width: 15px;
    height: 15px;
    place-items: center;
    border: 1px solid currentColor;
    border-radius: 3px;
    font-size: 13px;
    font-weight: 700;
    line-height: 1;
  }

  .plus-icon {
    color: #83c38f;
    background: #263b2d;
  }

  .minus-icon {
    color: #dc8884;
    background: #3b2928;
  }

  .module-icon {
    display: grid;
    width: 15px;
    height: 15px;
    flex: 0 0 auto;
    place-items: center;
  }

  .importance-icon {
    width: 9px;
    height: 9px;
    margin-inline: 3px;
    border: 1px solid #eee;
    border-radius: 50%;
    background: #d6d6d6;
    box-shadow: 0 0 5px rgb(214 214 214 / 35%);
  }

  .purpose-icon {
    color: #70b5a1;
  }

  .mood-icon::before {
    width: 9px;
    height: 9px;
    border: 1px solid #fff0b0;
    border-radius: 50%;
    background: #f1c85b;
    content: "";
  }

  .purpose-icon svg {
    width: 15px;
    height: 15px;
    fill: none;
    stroke: currentColor;
    stroke-linecap: round;
    stroke-linejoin: round;
    stroke-width: 1.4;
  }

  /* Placeholder glyph for R5 kinds; each kind's owner may give it a proper icon later. */
  .r5-icon {
    width: 11px;
    height: 11px;
    flex: 0 0 auto;
    border: 1.5px solid var(--text-dim);
    border-radius: 3px;
  }

  .beacon-icon {
    width: 13px;
    height: 13px;
    flex: 0 0 auto;
    border-radius: 50%;
    background: #e8b030;
    box-shadow: 0 0 0 2px rgb(232 176 48 / 18%);
  }

  .time-icon {
    position: relative;
    border-radius: 50%;
  }

  .time-icon::before,
  .time-icon::after {
    position: absolute;
    background: currentColor;
    content: "";
  }

  .time-icon::before { top: 2px; left: 4px; width: 1px; height: 3px; }
  .time-icon::after { top: 5px; left: 4px; width: 3px; height: 1px; }

  .calendar-icon { position: relative; border-radius: 2px; }
  .calendar-icon::before { position: absolute; inset: 2px 2px auto; height: 2px; background: currentColor; content: ""; }
  .calendar-icon::after { position: absolute; inset: 6px 2px 2px; background: repeating-linear-gradient(90deg, currentColor 0 1px, transparent 1px 3px), repeating-linear-gradient(0deg, currentColor 0 1px, transparent 1px 3px); content: ""; }

  .image-icon { position: relative; border-radius: 2px; }
  .image-icon::before { position: absolute; inset: 2px; border: 1px solid currentColor; border-radius: 1px; content: ""; }
  .image-icon::after { position: absolute; right: 3px; bottom: 3px; left: 3px; height: 5px; background: linear-gradient(140deg, transparent 0 27%, currentColor 29% 39%, transparent 41%), linear-gradient(40deg, transparent 0 41%, currentColor 43% 56%, transparent 58%); content: ""; }
  .audio-icon { position: relative; border-radius: 50%; }
  .audio-icon::before { position: absolute; inset: 3px; border: 1px solid currentColor; border-radius: 50%; content: ""; }
  .audio-icon::after { position: absolute; top: 2px; bottom: 2px; left: 6px; width: 2px; border-left: 1px solid currentColor; border-right: 1px solid currentColor; content: ""; }
  .record-audio-icon { border-radius: 50%; background: #d4473f; box-shadow: inset 0 0 0 4px #242424; }
  .hidden-file-input { display: none; }
  .video-icon { position: relative; }
  .video-icon::after { position: absolute; top: 2px; left: 4px; border-top: 3px solid transparent; border-bottom: 3px solid transparent; border-left: 4px solid currentColor; content: ""; }
  .youtube-icon { border-color: #d05a5a; border-radius: 3px; }
  .youtube-icon::after { position: absolute; top: 2px; left: 4px; border-top: 3px solid transparent; border-bottom: 3px solid transparent; border-left: 4px solid #d05a5a; content: ""; }
  .youtube-create-input { display: grid; gap: 5px; padding: 5px; border: 1px solid #484a50; border-radius: 3px; background: #222428; }
  .youtube-create-input input { box-sizing: border-box; width: 100%; min-width: 0; padding: 5px; border: 1px solid #555860; border-radius: 3px; color: var(--text); background: #18191c; font: inherit; font-size: 10px; }
  .youtube-create-error { color: #e59a94; font-size: 10px; overflow-wrap: anywhere; }
  .youtube-create-actions { display: flex; justify-content: flex-end; gap: 4px; }
  .youtube-create-actions button { padding: 4px 6px; border: 1px solid #4a4d53; border-radius: 3px; color: var(--text); background: #303238; font: inherit; font-size: 10px; cursor: pointer; }
</style>
