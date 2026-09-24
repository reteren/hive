<script lang="ts">
  import type { MoodKind, Note } from "../model/note";
  import ModuleChip from "../modules/ModuleChip.svelte";
  import ModulePicker from "../modules/ModulePicker.svelte";
  import { isMoodKind, MOOD_OPTIONS } from "../modules/moduleLogic";
  import { closeModulePicker, setStandaloneMood, toggleModulePicker } from "../modules/moduleActions.svelte";
  import { modulePicker } from "../modules/pickerState.svelte";

  let { note }: { note: Note } = $props();
  let mood = $derived(note.moods?.find(isMoodKind) ?? "happiness");
  let option = $derived(MOOD_OPTIONS.find((item) => item.id === mood)!);
  let isOpen = $derived(modulePicker.noteId === note.id && modulePicker.kind === "mood");

  function chooseMood(id: string): void {
    if (isMoodKind(id)) setStandaloneMood(note.id, id as MoodKind);
  }
</script>

<div class="module-node-body">
  <ModuleChip
    label={option.label}
    color={option.color}
    interactive={false}
    selectionIgnore={false}
    onDoubleClick={() => toggleModulePicker(note.id, "mood")}
  />
  {#if isOpen}
    <ModulePicker
      title="Mood"
      mode="single"
      options={MOOD_OPTIONS}
      selected={[mood]}
      onSelect={chooseMood}
      onClose={closeModulePicker}
    />
  {/if}
</div>
