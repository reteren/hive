<script lang="ts">
  import type { ImportanceLevel, Note } from "../model/note";
  import ModuleChip from "./ModuleChip.svelte";
  import ModulePicker from "./ModulePicker.svelte";
  import { IMPORTANCE_OPTIONS, PURPOSE_OPTIONS, isImportanceLevel, isPurposeKind } from "./moduleLogic";
  import {
    closeModulePicker,
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
  let purposeOption = $derived(PURPOSE_OPTIONS.find((option) => option.id === purposes[0]));
  let purposeLabel = $derived(purposeOption
    ? `${purposeOption.label}${purposes.length > 1 ? ` +${purposes.length - 1}` : ""}`
    : "Purpose");

  function chooseImportance(id: string): void {
    if (isImportanceLevel(id)) setImportance(note.id, id as ImportanceLevel);
  }

  function choosePurpose(id: string): void {
    if (isPurposeKind(id)) togglePurpose(note.id, id);
  }

  function noteImportance(): ImportanceLevel {
    return note.importance && isImportanceLevel(note.importance) ? note.importance : "basic";
  }

  function togglePicker(kind: "importance" | "purpose"): void {
    toggleModulePicker(note.id, kind);
  }
</script>

<div class="module-node-body">
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
    <ModuleChip
      label={purposeLabel}
      color={purposeOption?.color ?? "#b8b8b8"}
      iconPath={purposeOption?.iconPath}
      onClick={() => togglePicker("purpose")}
    />
    {#if pickerKind === "purpose"}
      <ModulePicker
        title="Purpose"
        mode="multiple"
        options={PURPOSE_OPTIONS}
        selected={purposes}
        onSelect={choosePurpose}
        onClose={closeModulePicker}
        floating
      />
    {/if}
  {/if}
</div>
