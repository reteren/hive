<script lang="ts">
  import type { ImportanceLevel, Note } from "../model/note";
  import ModuleChip from "./ModuleChip.svelte";
  import ModulePicker from "./ModulePicker.svelte";
  import { IMPORTANCE_OPTIONS, PURPOSE_OPTIONS, isImportanceLevel, isPurposeKind } from "./moduleLogic";
  import {
    closeModulePicker,
    moduleDropPreview,
    moduleFeedback,
    setImportance,
    toggleModulePicker,
    togglePurpose,
  } from "./moduleActions.svelte";
  import { modulePicker } from "./pickerState.svelte";

  let { note }: { note: Note } = $props();
  let pickerKind = $derived(modulePicker.noteId === note.id ? modulePicker.kind : null);
  let importance = $derived(noteImportance());
  let purposes = $derived(note.purposes?.filter(isPurposeKind) ?? []);
  let importanceOption = $derived(IMPORTANCE_OPTIONS.find((option) => option.id === importance)!);
  let isDropTarget = $derived(moduleDropPreview.targetId === note.id);
  let dropMessage = $derived(isDropTarget ? moduleDropPreview.reason : moduleFeedback.noteId === note.id ? moduleFeedback.message : null);

  function chooseImportance(id: string): void {
    if (isImportanceLevel(id)) setImportance(note.id, id as ImportanceLevel);
  }

  function choosePurpose(id: string): void {
    if (isPurposeKind(id)) togglePurpose(note.id, id);
  }

  function clickPurpose(id: string): void {
    if (pickerKind === "purpose" && isPurposeKind(id)) togglePurpose(note.id, id);
    else togglePicker("purpose");
  }

  function noteImportance(): ImportanceLevel {
    return note.importance && isImportanceLevel(note.importance) ? note.importance : "basic";
  }

  function togglePicker(kind: "importance" | "purpose"): void {
    toggleModulePicker(note.id, kind);
  }
</script>

<div class="module-node-body" data-module-drop-target={isDropTarget ? (moduleDropPreview.allowed ? "allowed" : "refused") : undefined}>
  {#if note.type === "importance"}
    <ModuleChip
      label={importanceOption.label}
      color={importanceOption.color}
      rainbow={importance === "absolute"}
      onClick={() => togglePicker("importance")}
    />
    {#if pickerKind === "importance"}
      <ModulePicker
        title="Importance"
        mode="single"
        options={IMPORTANCE_OPTIONS}
        selected={[importance]}
        onSelect={chooseImportance}
        onClose={closeModulePicker}
        floating
      />
    {/if}
  {:else if note.type === "purpose"}
    <button type="button" class="module-node-label" data-module-trigger data-selection-ignore onclick={() => togglePicker("purpose")}>Purpose</button>
    {#each purposes as purpose (purpose)}
      {@const option = PURPOSE_OPTIONS.find((item) => item.id === purpose)}
      {#if option}
        <ModuleChip label={option.label} color={option.color} iconPath={option.iconPath} onClick={() => clickPurpose(purpose)} />
      {/if}
    {/each}
    {#if purposes.length > 0}
      <button type="button" class="module-node-add" data-module-trigger data-selection-ignore aria-label="Add Purpose" onclick={() => togglePicker("purpose")}>
        <svg viewBox="0 0 12 12" aria-hidden="true" focusable="false"><path d="M6 2.5v7M2.5 6h7" /></svg>
      </button>
    {/if}
    {#if pickerKind === "purpose"}
      <ModulePicker
        title="Purpose"
        mode="multiple"
        options={PURPOSE_OPTIONS}
        selected={purposes}
        onSelect={choosePurpose}
        onClose={closeModulePicker}
        floating
        hideSelected
      />
    {/if}
  {/if}
  {#if dropMessage}<span class="module-node-drop-message" role="status">{dropMessage}</span>{/if}
</div>
