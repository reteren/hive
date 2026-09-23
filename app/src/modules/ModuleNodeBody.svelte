<script lang="ts">
  import type { ImportanceLevel, Note, PurposeKind } from "../model/note";
  import ModuleChip from "./ModuleChip.svelte";
  import ModulePicker from "./ModulePicker.svelte";
  import { IMPORTANCE_OPTIONS, PURPOSE_OPTIONS, isImportanceLevel, isPurposeKind } from "./moduleLogic";
  import { closeModulePicker, openModulePicker, setImportance, setStandalonePurpose } from "./moduleActions.svelte";
  import { modulePicker } from "./pickerState.svelte";

  let { note }: { note: Note } = $props();
  let pickerKind = $derived(modulePicker.noteId === note.id ? modulePicker.kind : null);
  let importance = $derived(noteImportance());
  let purpose = $derived(note.purposes?.find(isPurposeKind) ?? "concept");
  let importanceOption = $derived(IMPORTANCE_OPTIONS.find((option) => option.id === importance)!);
  let purposeOption = $derived(PURPOSE_OPTIONS.find((option) => option.id === purpose)!);

  function chooseImportance(id: string): void {
    if (isImportanceLevel(id)) setImportance(note.id, id as ImportanceLevel);
  }

  function choosePurpose(id: string): void {
    if (isPurposeKind(id)) setStandalonePurpose(note.id, id as PurposeKind);
  }

  function noteImportance(): ImportanceLevel {
    return note.importance && isImportanceLevel(note.importance) ? note.importance : "basic";
  }
</script>

<div class="module-node-body">
  {#if note.type === "importance"}
    <ModuleChip
      label={importanceOption.label}
      color={importanceOption.color}
      rainbow={importance === "absolute"}
      interactive={false}
      selectionIgnore={false}
      onDoubleClick={() => openModulePicker(note.id, "importance")}
    />
    {#if pickerKind === "importance"}
      <ModulePicker
        title="Importance"
        mode="single"
        options={IMPORTANCE_OPTIONS}
        selected={[importance]}
        onSelect={chooseImportance}
        onClose={closeModulePicker}
      />
    {/if}
  {:else if note.type === "purpose"}
    <ModuleChip
      label={purposeOption.label}
      color={purposeOption.color}
      iconPath={purposeOption.iconPath}
      interactive={false}
      selectionIgnore={false}
      onDoubleClick={() => openModulePicker(note.id, "purpose")}
    />
    {#if pickerKind === "purpose"}
      <ModulePicker
        title="Purpose"
        mode="single"
        options={PURPOSE_OPTIONS}
        selected={[purpose]}
        onSelect={choosePurpose}
        onClose={closeModulePicker}
      />
    {/if}
  {/if}
</div>
