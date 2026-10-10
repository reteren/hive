<script lang="ts">
  import { invoke, isTauri } from "@tauri-apps/api/core";
  import { board } from "../model/board.svelte";
  import { links } from "../model/links.svelte";
  import { normalizeNoteScale } from "../model/note";
  import { measuredHeights } from "../notes/layout.svelte";
  import { taskLog } from "../tasks/taskLog.svelte";
  import { editTime } from "../changes/changeMarks.svelte";
  import { savedNoteFiles } from "../project/persistence.svelte";
  import { KIND_LABELS } from "../overview/overviewLogic";
  import { attachmentUrl } from "../attachments/service";
  import { closeNodeInfo, infoWindow } from "./infoWindow.svelte";
  import {
    collectionStats,
    formatAgo,
    formatBytes,
    formatClock,
    formatDate,
    formatSpan,
    mediaFacts,
    taskStats,
    textStats,
  } from "./nodeInfoLogic";

  interface Commit { hash: string; author: string; at: number; subject: string }
  interface GitInfo { me: string; uncommitted: boolean; commits: Commit[]; textAuthors: [string, number][] }
  interface DiskInfo {
    nodeFile: string;
    nodeBytes: number | null;
    noteFile: string | null;
    noteBytes: number | null;
    attachmentBytes: number;
    git: GitInfo | null;
  }

  const TEXT_KINDS = new Set(["note", "pro", "con", "goal", "source", "glossary", "markas", "message", "time"]);

  let disk = $state<DiskInfo | null>(null);
  let diskError = $state("");
  let pdfPages = $state<number | null>(null);
  let logOpen = $state(false);
  let openCommit = $state<string | null>(null);
  let diffs = $state<Record<string, string>>({});
  let revealError = $state("");
  let now = $state(Date.now());
  let closeButton = $state<HTMLButtonElement | null>(null);

  const note = $derived(infoWindow.noteId ? board.notes[infoWindow.noteId] : undefined);
  const noteFile = $derived(note ? savedNoteFiles().get(note.id) ?? null : null);
  const media = $derived(note ? mediaFacts(note) : null);
  const text = $derived(note && (TEXT_KINDS.has(note.type) || note.text.trim()) ? textStats(note.text) : null);
  const collection = $derived(note ? collectionStats(note, board.notes, Object.values(links.byId)) : null);
  const task = $derived(note ? taskStats(note, taskLog.entries) : null);
  const commits = $derived(disk?.git?.commits ?? []);
  const oldest = $derived(commits.at(-1));
  const newest = $derived(commits[0]);
  const createdAt = $derived(note?.createdAt ?? (oldest ? oldest.at * 1000 : null));
  const textAuthors = $derived(disk?.git?.textAuthors ?? []);
  const textTotal = $derived(textAuthors.reduce((sum, [, chars]) => sum + chars, 0));
  const totalBytes = $derived(disk ? (disk.nodeBytes ?? 0) + (disk.noteBytes ?? 0) + disk.attachmentBytes : null);
  const spentMs = $derived(note ? editTime.byId[note.id] ?? 0 : 0);

  // Loaded once per opened node; Info shows the state on disk at that moment.
  $effect(() => {
    const id = infoWindow.noteId;
    disk = null;
    diskError = "";
    pdfPages = null;
    logOpen = false;
    openCommit = null;
    diffs = {};
    revealError = "";
    now = Date.now();
    if (!id) return;
    const current = board.notes[id];
    if (!current) return;
    const frame = requestAnimationFrame(() => closeButton?.focus());
    let cancelled = false;
    if (isTauri()) {
      void invoke<DiskInfo>("node_info", {
        id,
        file: savedNoteFiles().get(id) ?? null,
        attachments: mediaFacts(current)?.files ?? [],
      }).then((info) => {
        if (!cancelled) disk = info;
      }).catch((error: unknown) => {
        if (!cancelled) diskError = String(error);
      });
    }
    if (current.type === "pdf" && current.media) void countPdfPages(current.media.file).then((pages) => {
      if (!cancelled) pdfPages = pages;
    });
    const clock = setInterval(() => { now = Date.now(); }, 30_000);
    return () => {
      cancelled = true;
      cancelAnimationFrame(frame);
      clearInterval(clock);
    };
  });

  // The node was deleted while its Info was open.
  $effect(() => {
    if (infoWindow.noteId && !board.notes[infoWindow.noteId]) closeNodeInfo();
  });

  async function countPdfPages(file: string): Promise<number | null> {
    const url = attachmentUrl(file);
    if (!url) return null;
    try {
      const { pdfjs } = await import("../formats/pdfjsClient");
      const task = pdfjs.getDocument({ url });
      const pages = (await task.promise).numPages;
      void task.destroy();
      return pages;
    } catch {
      return null;
    }
  }

  async function toggleCommit(hash: string): Promise<void> {
    if (openCommit === hash) {
      openCommit = null;
      return;
    }
    openCommit = hash;
    if (diffs[hash] !== undefined || !note) return;
    try {
      const diff = await invoke<string>("node_commit_diff", { hash, id: note.id, file: noteFile });
      diffs = { ...diffs, [hash]: diff };
    } catch (error) {
      diffs = { ...diffs, [hash]: `Could not load this version: ${String(error)}` };
    }
  }

  async function reveal(relative: string): Promise<void> {
    revealError = "";
    try {
      await invoke("reveal_node_file", { relative });
    } catch (error) {
      revealError = String(error);
    }
  }

  function handleKeydown(event: KeyboardEvent): void {
    if (event.key !== "Escape" || event.defaultPrevented) return;
    event.preventDefault();
    event.stopPropagation();
    closeNodeInfo();
  }

  const DIFF_HEADER = /^(index |--- |\+\+\+ |new file mode|deleted file mode|similarity index|rename (from|to) |\\ No newline)/;

  /** Git's diff without its file headers; each file part is labelled "Text" or "Node data". */
  function diffLines(diff: string): { kind: string; text: string }[] {
    const lines: { kind: string; text: string }[] = [];
    for (const line of diff.split("\n")) {
      if (line.startsWith("diff --git ")) {
        lines.push({ kind: "file", text: line.includes(" b/notes/") ? "Text" : "Node data" });
      } else if (DIFF_HEADER.test(line)) {
        continue;
      } else if (line.startsWith("@@")) {
        lines.push({ kind: "hunk", text: "⋯" });
      } else if (line.startsWith("+")) {
        lines.push({ kind: "add", text: line });
      } else if (line.startsWith("-")) {
        lines.push({ kind: "remove", text: line });
      } else if (line) {
        lines.push({ kind: "context", text: line });
      }
    }
    return lines;
  }

  function percent(part: number, whole: number): string {
    return whole > 0 ? `${Math.round((part / whole) * 100)}%` : "0%";
  }

  function plural(count: number, word: string): string {
    return `${count.toLocaleString("en-US")} ${word}${count === 1 ? "" : "s"}`;
  }

  function round(value: number): string {
    return String(Math.round(value * 10) / 10);
  }
</script>

{#if note}
  {@const height = note.height ?? measuredHeights[note.id] ?? null}
  <div class="info-window" data-selection-ignore data-node-info role="dialog" aria-label={`Info: ${note.name}`} tabindex="-1" onkeydown={handleKeydown}>
    <header class="info-heading">
      <div class="info-title">
        <h2>{note.name}</h2>
        <span>{KIND_LABELS[note.type] ?? note.type}</span>
      </div>
      <button bind:this={closeButton} class="close-button" type="button" aria-label="Close info" title="Close (Esc)" onclick={closeNodeInfo}>×</button>
    </header>

    <div class="info-body">
      <dl class="facts">
        <dt>Created</dt>
        <dd>{#if createdAt}{formatDate(createdAt)} <span class="dim">· exists {formatSpan(now - createdAt)}</span>{:else}<span class="dim">unknown</span>{/if}</dd>
        {#if disk?.git}
          <dt>Created by</dt>
          <dd>{oldest?.author ?? (disk.git.uncommitted ? `${disk.git.me || "you"} (not committed yet)` : "—")}</dd>
          <dt>Last changed</dt>
          <dd data-info-last-changed>
            {#if disk.git.uncommitted}not committed yet · {disk.git.me || "you"}
            {:else if newest}{formatAgo(newest.at * 1000, now)} · {newest.author}
            {:else}—{/if}
          </dd>
        {/if}
        <dt>Scale</dt>
        <dd>{Math.round(normalizeNoteScale(note.scale) * 100)}%</dd>
        <dt>Position</dt>
        <dd class="mono">X {round(note.x)} · Y {round(note.y)} <span class="dim">· {round(note.width)} × {height === null ? "auto" : round(height)}</span></dd>
        <dt>Your time here</dt>
        <dd>{spentMs >= 1000 ? formatSpan(spentMs) : "—"} <span class="dim">editing</span></dd>
      </dl>

      {#if text}
        <section class="info-section">
          <h3>Text</h3>
          <p class="stat-line" data-info-text>
            {plural(text.words, "word")} · {plural(text.characters, "character")} · {plural(text.lines, "line")}{#if text.readingMinutes} · ~{text.readingMinutes} min read{/if}
          </p>
          {#if textAuthors.length > 0}
            <ul class="authors" aria-label="Who wrote the text">
              {#each textAuthors as [author, chars] (author)}
                <li>
                  <span class="author-name">{author}{author === disk?.git?.me ? " (you)" : ""}</span>
                  <span class="author-bar"><span style:width={percent(chars, textTotal)}></span></span>
                  <span class="mono dim">{percent(chars, textTotal)}</span>
                </li>
              {/each}
            </ul>
          {/if}
        </section>
      {/if}

      {#if collection}
        <section class="info-section">
          <h3>{note.type === "tierlist" ? "Cards" : "Items"}</h3>
          <p class="stat-line">{plural(collection.items, note.type === "tierlist" ? "card" : "item")}{#if collection.done !== null} · {collection.done} done ({percent(collection.done, collection.items)}){/if}</p>
        </section>
      {/if}

      {#if task}
        <section class="info-section">
          <h3>Task</h3>
          <dl class="facts">
            <dt>Status</dt>
            <dd>{task.doneAt !== null ? `done ${formatDate(task.doneAt)}` : "open"}</dd>
            {#if task.openForMs !== null}<dt>Took</dt><dd>{formatSpan(task.openForMs)} <span class="dim">from creation</span></dd>{/if}
            <dt>Completed</dt>
            <dd>{task.timesCompleted === 1 ? "once" : `${task.timesCompleted} times`}</dd>
          </dl>
        </section>
      {/if}

      {#if media || note.youtube}
        <section class="info-section">
          <h3>Media</h3>
          <dl class="facts">
            {#if media?.name}<dt>File name</dt><dd class="wrap">{media.name}</dd>{/if}
            {#if media?.format}<dt>Format</dt><dd>{media.format}</dd>{/if}
            {#if media?.width && media.height}<dt>Resolution</dt><dd class="mono">{media.width} × {media.height}</dd>{/if}
            {#if media?.durationSeconds}<dt>Duration</dt><dd class="mono">{formatClock(media.durationSeconds)}</dd>{/if}
            {#if note.type === "pdf"}<dt>Pages</dt><dd>{pdfPages ?? "…"}</dd>{/if}
            {#if note.youtube}
              {#if note.youtube.title}<dt>Video</dt><dd class="wrap">{note.youtube.title}</dd>{/if}
              {#if note.youtube.author}<dt>Channel</dt><dd>{note.youtube.author}</dd>{/if}
            {/if}
          </dl>
        </section>
      {/if}

      <section class="info-section">
        <h3>On disk</h3>
        {#if disk}
          <p class="stat-line">{totalBytes !== null ? formatBytes(totalBytes) : "—"}{#if disk.attachmentBytes > 0} <span class="dim">· attachments {formatBytes(disk.attachmentBytes)}</span>{/if}</p>
          <ul class="files">
            {#if disk.noteFile}
              <li><span class="mono wrap">{disk.noteFile}</span><button type="button" onclick={() => reveal(disk!.noteFile!)}>Show in Explorer</button></li>
            {/if}
            <li><span class="mono wrap">{disk.nodeFile}</span><button type="button" onclick={() => reveal(disk!.nodeFile)}>Show in Explorer</button></li>
          </ul>
          {#if revealError}<p class="error" role="alert">{revealError}</p>{/if}
        {:else if diskError}
          <p class="error" role="alert">{diskError}</p>
        {:else}
          <p class="stat-line dim">{isTauri() ? "Reading…" : "Available in the desktop app."}</p>
        {/if}
      </section>
    </div>

    {#if disk?.git}
      <footer class="history" data-info-history>
        <button class="history-toggle" type="button" aria-expanded={logOpen} onclick={() => { logOpen = !logOpen; }}>
          <span class="chevron" class:open={logOpen} aria-hidden="true">›</span>
          Version history
          <span class="dim">{commits.length}{disk.git.uncommitted ? " + uncommitted" : ""}</span>
        </button>
        {#if logOpen}
          <ol class="commits">
            {#if commits.length === 0}<li class="dim empty">Not committed yet.</li>{/if}
            {#each commits as commit (commit.hash)}
              <li>
                <button type="button" class="commit" class:open={openCommit === commit.hash} aria-expanded={openCommit === commit.hash} onclick={() => toggleCommit(commit.hash)}>
                  <span class="mono dim">{formatDate(commit.at * 1000)}</span>
                  <span class="commit-author">{commit.author}</span>
                  <span class="commit-subject dim">{commit.subject}</span>
                </button>
                {#if openCommit === commit.hash}
                  <pre class="diff">{#if diffs[commit.hash] === undefined}<span class="dim">Loading…</span>{:else if diffs[commit.hash] === ""}<span class="dim">No changes to this node in this version.</span>{:else}{#each diffLines(diffs[commit.hash]!) as line, index (index)}<span class={line.kind}>{line.text}{"\n"}</span>{/each}{/if}</pre>
                {/if}
              </li>
            {/each}
          </ol>
        {/if}
      </footer>
    {/if}
  </div>
{/if}

<style>
  .info-window {
    position: fixed;
    z-index: 40;
    top: 44px;
    right: 8px;
    display: flex;
    width: min(330px, calc(100% - 16px));
    max-height: min(620px, calc(100% - 54px));
    flex-direction: column;
    overflow: hidden;
    border: 1px solid var(--border);
    border-radius: 6px;
    background: var(--bg-panel);
    box-shadow: 0 10px 28px rgb(0 0 0 / 45%);
    color: var(--text);
    font-size: 11px;
    pointer-events: auto;
    animation: info-in 140ms ease-out;
  }

  @keyframes info-in {
    from { opacity: 0; transform: translateY(-4px); }
  }

  @media (prefers-reduced-motion: reduce) {
    .info-window { animation: none; }
  }

  .info-heading {
    display: flex;
    min-height: 40px;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    padding: 6px 6px 6px 12px;
    border-bottom: 1px solid #3b3b3b;
    border-top: 2px solid var(--accent);
  }

  .info-title { display: flex; min-width: 0; flex-direction: column; gap: 1px; }
  .info-title > span { color: var(--text-dim); font-size: 9px; letter-spacing: 0.05em; text-transform: uppercase; }

  h2 {
    overflow: hidden;
    margin: 0;
    font-size: 12px;
    font-weight: 600;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  h3 {
    margin: 0 0 5px;
    color: var(--text-dim);
    font-size: 9px;
    font-weight: 600;
    letter-spacing: 0.05em;
    text-transform: uppercase;
  }

  .close-button {
    width: 26px;
    height: 26px;
    flex: 0 0 auto;
    border: 1px solid transparent;
    border-radius: 3px;
    background: transparent;
    color: var(--text-dim);
    font-size: 16px;
    line-height: 1;
    cursor: pointer;
  }

  .close-button:hover { background: var(--bg-hover); color: var(--text); }

  .info-body {
    min-height: 0;
    overflow: auto;
    padding: 8px 12px 10px;
  }

  .info-section {
    margin-top: 10px;
    padding-top: 9px;
    border-top: 1px solid #353535;
  }

  .facts {
    display: grid;
    grid-template-columns: max-content minmax(0, 1fr);
    gap: 5px 12px;
    margin: 0;
  }

  dt { color: var(--text-dim); }
  dd { min-width: 0; margin: 0; }

  .stat-line { margin: 0; line-height: 1.5; }
  .dim { color: var(--text-dim); }
  .mono { font-family: var(--mono-font); font-size: 10px; font-variant-numeric: tabular-nums; }
  .wrap { overflow-wrap: anywhere; }
  .error { margin: 6px 0 0; color: #ffb0a6; font-size: 10px; }

  .authors {
    display: grid;
    gap: 4px;
    margin: 7px 0 0;
    padding: 0;
    list-style: none;
  }

  .authors li {
    display: grid;
    grid-template-columns: minmax(0, 7.5em) minmax(0, 1fr) 3em;
    align-items: center;
    gap: 8px;
  }

  .author-name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

  .author-bar {
    height: 5px;
    overflow: hidden;
    border-radius: 999px;
    background: rgb(255 255 255 / 8%);
  }

  .author-bar > span {
    display: block;
    height: 100%;
    border-radius: inherit;
    background: var(--accent);
  }

  .authors .mono { text-align: right; }

  .files {
    display: grid;
    gap: 4px;
    margin: 6px 0 0;
    padding: 0;
    list-style: none;
  }

  .files li { display: flex; align-items: center; justify-content: space-between; gap: 8px; }

  .files button {
    flex: 0 0 auto;
    min-height: 22px;
    padding: 2px 7px;
    border: 1px solid var(--border);
    border-radius: 3px;
    background: var(--bg-panel-raised);
    color: var(--text);
    font: inherit;
    font-size: 9px;
    cursor: pointer;
  }

  .files button:hover { background: var(--bg-hover); }

  .history {
    display: flex;
    min-height: 0;
    max-height: 45%;
    flex-direction: column;
    border-top: 1px solid #3b3b3b;
    background: rgb(0 0 0 / 12%);
  }

  .history-toggle {
    display: flex;
    min-height: 32px;
    flex: 0 0 auto;
    align-items: center;
    gap: 7px;
    padding: 4px 12px;
    border: 0;
    background: transparent;
    color: var(--text);
    font: inherit;
    font-weight: 600;
    text-align: left;
    cursor: pointer;
  }

  .history-toggle:hover { background: var(--bg-hover); }
  .history-toggle .dim { margin-left: auto; font-weight: 400; }

  .chevron {
    display: inline-block;
    color: var(--accent);
    font-size: 14px;
    line-height: 1;
    transition: transform 140ms ease-out;
  }

  .chevron.open { transform: rotate(90deg); }

  @media (prefers-reduced-motion: reduce) {
    .chevron { transition: none; }
  }

  .commits {
    min-height: 0;
    overflow: auto;
    margin: 0;
    padding: 0 6px 8px;
    list-style: none;
  }

  .empty { padding: 4px 6px; }

  .commit {
    display: grid;
    width: 100%;
    grid-template-columns: max-content max-content minmax(0, 1fr);
    align-items: baseline;
    gap: 8px;
    padding: 4px 6px;
    border: 0;
    border-radius: 3px;
    background: transparent;
    color: var(--text);
    font: inherit;
    text-align: left;
    cursor: pointer;
  }

  .commit:hover, .commit.open { background: var(--bg-hover); }
  .commit-author { font-weight: 600; }
  .commit-subject { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

  .diff {
    max-height: 220px;
    overflow: auto;
    margin: 3px 0 6px;
    padding: 6px 8px;
    border: 1px solid #353535;
    border-radius: 3px;
    background: rgb(0 0 0 / 25%);
    font-family: var(--mono-font);
    font-size: 9.5px;
    line-height: 1.45;
    white-space: pre-wrap;
    overflow-wrap: anywhere;
  }

  .diff .add { color: #8fd18f; }
  .diff .remove { color: #f19a8f; }
  .diff .hunk { color: #8fb7e8; }
  .diff .file {
    display: block;
    margin-top: 4px;
    color: var(--text-dim);
    font-family: inherit;
    font-size: 9px;
    font-weight: 600;
    letter-spacing: 0.05em;
    text-transform: uppercase;
  }

  .diff .file:first-child { margin-top: 0; }
  .diff .context { color: var(--text-dim); }

  .close-button:focus-visible,
  .files button:focus-visible,
  .history-toggle:focus-visible,
  .commit:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: -2px;
  }
</style>
