<script lang="ts">
  import type { Note } from "../model/note";
  import ModuleChip from "../modules/ModuleChip.svelte";
  import ModulePicker from "../modules/ModulePicker.svelte";
  import { isMoodKind, MOOD_OPTIONS } from "../modules/moduleLogic";
  import { closeModulePicker, toggleMood, toggleModulePicker } from "../modules/moduleActions.svelte";
  import { modulePicker } from "../modules/pickerState.svelte";

  let { note }: { note: Note } = $props();
  let moods = $derived(note.moods?.filter(isMoodKind) ?? []);
  let option = $derived(MOOD_OPTIONS.find((item) => item.id === moods[0]));
  let label = $derived(option
    ? `${option.label}${moods.length > 1 ? ` +${moods.length - 1}` : ""}`
    : "Mood");
  let isOpen = $derived(modulePicker.noteId === note.id && modulePicker.kind === "mood");

  function chooseMood(id: string): void {
    if (isMoodKind(id)) toggleMood(note.id, id);
  }
</script>

<div class="module-node-body">
  <ModuleChip
    {label}
    color={option?.color ?? "#b8b8b8"}
    onClick={() => toggleModulePicker(note.id, "mood")}
  />
  {#if isOpen}
    <ModulePicker
      title="Mood"
      mode="multiple"
      options={MOOD_OPTIONS}
      selected={moods}
      onSelect={chooseMood}
      onClose={closeModulePicker}
      floating
    />
  {/if}
</div>
