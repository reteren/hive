<script lang="ts">
  import { tick } from "svelte";
  import type { Note } from "../model/note";
  import { board } from "../model/board.svelte";
  import { links } from "../model/links.svelte";
  import { getCommand } from "../commands/registry.svelte";
  import { matchesKey } from "../commands/keys";
  import { isTauri } from "@tauri-apps/api/core";
  import { defaultMessageData } from "./data";
  import { setMessageSettings, setMessageText } from "./actions.svelte";
  import { prepareMessageSound } from "./sound";
  import { messageTextFieldState } from "./resolution";

  let { note }: { note: Note } = $props();
  let settings = $derived(note.message ?? defaultMessageData());
  let textField = $derived(messageTextFieldState(note, board.notes, Object.values(links.byId), board.order));
  const desktop = isTauri();
  let textArea: HTMLTextAreaElement | undefined = $state();
  let editGroup = Symbol();
  $effect(() => { const text = textField.value; void tick().then(() => { if (textArea?.value === text) resizeText(); }); });
  function resizeText(): void {
    if (!textArea) return;
    textArea.style.height = "auto";
    textArea.style.height = `${Math.max(60, textArea.scrollHeight)}px`;
  }
  function editText(event: Event): void {
    if (textField.readOnly) return;
    setMessageText(note.id, (event.currentTarget as HTMLTextAreaElement).value, editGroup);
    resizeText();
  }
  function editKey(event: KeyboardEvent): void {
    if (event.isComposing) return;
    const command = [getCommand("edit.undo"), getCommand("edit.redo")]
      .find((candidate) => candidate?.keys.some((key) => matchesKey(event, key)));
    if (!command) return;
    event.preventDefault(); event.stopPropagation();
    if (event.repeat) return;
    editGroup = Symbol(); command.run();
  }
</script>

<div class="message-node-body" data-message-node={note.id} data-selection-ignore role="group" aria-label={`Message ${note.name}`}>
  <label class="message-field">
    <span>Message text</span>
    <textarea data-message-text data-message-linked-task={textField.linkedTaskId ?? undefined}
      aria-label={textField.readOnly ? "Linked task message text" : "Message text"}
      title={textField.readOnly ? "Text comes from the linked task" : undefined}
      placeholder="What should the reminder say?" rows="3" bind:this={textArea}
      value={textField.value} readonly={textField.readOnly}
      oninput={editText} onfocus={() => { editGroup = Symbol(); }} onblur={() => { editGroup = Symbol(); }} onkeydown={editKey}></textarea>
  </label>
  <label class="message-sound"><input type="checkbox" data-message-sound checked={settings.sound}
    onchange={(event) => { const sound = event.currentTarget.checked; setMessageSettings(note.id, { sound }); if (sound) void prepareMessageSound(); }} /> Sound</label>
  <label class="message-sound"><input type="checkbox" data-message-overhive checked={settings.overhive} disabled={!desktop}
    onchange={(event) => setMessageSettings(note.id, { overhive: event.currentTarget.checked })} /> Overhive</label>
  {#if !desktop}<p class="message-hint">Overhive is available in the desktop app.</p>{/if}
</div>

<style>
  .message-node-body { display: grid; gap: 7px; min-width: 0; font-size: 11px; }
  .message-field { display: grid; gap: 4px; color: var(--text-dim); }
  textarea { box-sizing: border-box; padding: 5px 6px; border: 1px solid #51545b; border-radius: 3px; color: var(--text); background: #222429; font: inherit; }
  textarea { display: block; width: 100%; min-height: 60px; resize: none; overflow: hidden; line-height: 1.4; }
  textarea:focus { outline: 1px solid var(--accent); outline-offset: -1px; }
  textarea:read-only { color: #a9a9a9; background: #2b2b2b; border-color: #454545; cursor: default; }
  .message-sound { display: flex; align-items: center; gap: 6px; user-select: none; }
  .message-sound input { accent-color: var(--accent); }
  .message-hint { margin: 0; font-size: 10px; line-height: 1.35; color: var(--text-dim); }
</style>
