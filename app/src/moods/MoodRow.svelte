<!-- Mood chips occupy the third inserted-module row and use color without pictograms. -->
<script lang="ts">
  import type { Note } from "../model/note";
  import { effectiveMoods, linkedMoods, toggleModulePicker } from "../modules/moduleActions.svelte";
  import { MOOD_OPTIONS } from "../modules/moduleLogic";
  import { modulePicker } from "../modules/pickerState.svelte";
  import ModuleChip from "../modules/ModuleChip.svelte";

  let { note }: { note: Note } = $props();
  let moods = $derived(effectiveMoods(note.id));
  let linked = $derived(linkedMoods(note.id));
  let isOpen = $derived(modulePicker.noteId === note.id && modulePicker.kind === "mood");

</script>

<div class="note-module-row" data-module-row="mood">
  {#each moods as mood (mood)}
    {@const option = MOOD_OPTIONS.find((item) => item.id === mood)}
    {#if option}
      <ModuleChip
        label={option.label}
        color={option.color}
        linked={linked.includes(mood)}
        pressed={isOpen}
        interactive
        onClick={() => toggleModulePicker(note.id, "mood")}
        dragKind={note.moods?.includes(mood) ? "mood" : undefined}
        dragValue={note.moods?.includes(mood) ? mood : undefined}
        dragNoteId={note.id}
      />
    {/if}
  {/each}
</div>
