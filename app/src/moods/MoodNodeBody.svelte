<script lang="ts">
  import type { Note } from "../model/note";
  import ModuleChip from "../modules/ModuleChip.svelte";
  import ModulePicker from "../modules/ModulePicker.svelte";
  import { isMoodKind, MOOD_OPTIONS } from "../modules/moduleLogic";
  import { closeModulePicker, moduleDropPreview, moduleFeedback, toggleMood, toggleModulePicker } from "../modules/moduleActions.svelte";
  import { modulePicker } from "../modules/pickerState.svelte";

  let { note }: { note: Note } = $props();
  let moods = $derived(note.moods?.filter(isMoodKind) ?? []);
  let isOpen = $derived(modulePicker.noteId === note.id && modulePicker.kind === "mood");
  let isDropTarget = $derived(moduleDropPreview.targetId === note.id);
  let dropMessage = $derived(isDropTarget ? moduleDropPreview.reason : moduleFeedback.noteId === note.id ? moduleFeedback.message : null);

  function chooseMood(id: string): void {
    if (isMoodKind(id)) toggleMood(note.id, id);
  }

  function clickMood(id: string): void {
    if (isOpen && isMoodKind(id)) toggleMood(note.id, id);
    else toggleModulePicker(note.id, "mood");
  }
</script>

<div class="module-node-body" data-module-drop-target={isDropTarget ? (moduleDropPreview.allowed ? "allowed" : "refused") : undefined}>
  {#if moods.length === 0}
    <button type="button" class="module-node-label" data-module-trigger data-selection-ignore onclick={() => toggleModulePicker(note.id, "mood")}>Mood</button>
  {:else}
    {#each moods as mood (mood)}
      {@const option = MOOD_OPTIONS.find((item) => item.id === mood)}
      {#if option}
        <ModuleChip label={option.label} color={option.color} onClick={() => clickMood(mood)} />
      {/if}
    {/each}
    <button type="button" class="module-node-add" data-module-trigger data-selection-ignore aria-label="Add Mood" onclick={() => toggleModulePicker(note.id, "mood")}>
      <svg viewBox="0 0 12 12" aria-hidden="true" focusable="false"><path d="M6 2.5v7M2.5 6h7" /></svg>
    </button>
  {/if}
  {#if isOpen}
    <ModulePicker
      title="Mood"
      mode="multiple"
      options={MOOD_OPTIONS}
      selected={moods}
      onSelect={chooseMood}
      onClose={closeModulePicker}
      floating
      hideSelected
    />
  {/if}
  {#if dropMessage}<span class="module-node-drop-message" role="status">{dropMessage}</span>{/if}
</div>
