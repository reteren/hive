<script lang="ts">
  import type { ImportanceLevel, Note, PurposeKind } from "../model/note";
  import {
    closeModulePicker,
    effectiveImportance,
    effectiveMoods,
    effectivePurposes,
    linkedImportanceSource,
    linkedPurposes,
    makeImportanceLocal,
    moduleDropPreview,
    moduleFeedback,
    setImportance,
    setLinkedImportance,
    toggleModulePicker,
    togglePurpose,
  } from "./moduleActions.svelte";
  import { IMPORTANCE_OPTIONS, PURPOSE_OPTIONS, isImportanceLevel, isPurposeKind, moduleRowsFor } from "./moduleLogic";
  import { modulePicker } from "./pickerState.svelte";
  import ModuleChip from "./ModuleChip.svelte";
  import ModulePicker from "./ModulePicker.svelte";
  import MoodRow from "../moods/MoodRow.svelte";
  import "./commands";

  let { note }: { note: Note } = $props();
  let isContentNote = $derived(note.type === "note" || note.type === "pro" || note.type === "con");
  let pickerKind = $derived(isContentNote && modulePicker.noteId === note.id ? modulePicker.kind : null);
  let shownImportance = $derived(isContentNote ? effectiveImportance(note.id) : null);
  let shownPurposes = $derived(isContentNote ? effectivePurposes(note.id) : []);
  let shownMoods = $derived(isContentNote ? effectiveMoods(note.id) : []);
  let linkedImportance = $derived(isContentNote ? linkedImportanceSource(note.id) : null);
  let pickerImportance = $derived(linkedImportance?.importance ?? shownImportance);
  let importanceIsExternal = $derived(linkedImportance !== null);
  let isDropTarget = $derived(moduleDropPreview.targetId === note.id);
  let dropMessage = $derived(
    moduleDropPreview.moduleId && isDropTarget ? moduleDropPreview.reason :
      moduleFeedback.noteId === note.id ? moduleFeedback.message : null,
  );
  let rows = $derived(moduleRowsFor(shownImportance, shownPurposes, shownMoods));
  let displayedRows = $derived(
    modulePicker.noteId === note.id && modulePicker.kind === "mood" && !rows.includes("mood")
      ? [...rows, "mood"]
      : rows,
  );
  let hasModules = $derived(rows.length > 0);

  function chooseImportance(id: string): void {
    if (isImportanceLevel(id) && !importanceIsExternal) setImportance(note.id, id);
  }

  function changeLinkedImportance(id: string): void {
    if (isImportanceLevel(id)) setLinkedImportance(note.id, id);
  }

  function localizeImportance(id: string): void {
    if (isImportanceLevel(id)) makeImportanceLocal(note.id, id);
  }

  function choosePurpose(id: string): void {
    if (isPurposeKind(id)) togglePurpose(note.id, id);
  }

  function openPicker(kind: "importance" | "purpose"): void {
    toggleModulePicker(note.id, kind);
  }
</script>

{#if isContentNote && (hasModules || pickerKind || isDropTarget || moduleFeedback.noteId === note.id)}
  <div
    class="note-modules"
    data-module-rows={displayedRows.join(" ")}
    data-module-drop-target={isDropTarget ? (moduleDropPreview.allowed ? "allowed" : "refused") : undefined}
  >
    {#if shownImportance}
      {@const option = IMPORTANCE_OPTIONS.find((item) => item.id === shownImportance)}
      {#if option}
        <div class="note-module-row" data-module-row="importance">
          <ModuleChip
            label={option.label}
            color={option.color}
            rainbow={shownImportance === "absolute"}
            linked={importanceIsExternal}
            pressed={pickerKind === "importance"}
            interactive
            onClick={() => openPicker("importance")}
            dragKind={note.importance ? "importance" : undefined}
            dragValue={note.importance ?? undefined}
            dragNoteId={note.id}
          />
        </div>
      {/if}
    {/if}

    {#if shownPurposes.length > 0}
      <div class="note-module-row" data-module-row="purpose">
        {#each shownPurposes as purpose (purpose)}
          {@const option = PURPOSE_OPTIONS.find((item) => item.id === purpose)}
          {@const isExternal = linkedPurposes(note.id).includes(purpose)}
          {@const isEmbedded = note.purposes?.includes(purpose) ?? false}
          {#if option}
            <ModuleChip
              label={option.label}
              color={option.color}
              iconPath={option.iconPath}
              linked={isExternal}
              pressed={pickerKind === "purpose"}
              interactive
              onClick={() => openPicker("purpose")}
              dragKind={isEmbedded ? "purpose" : undefined}
              dragValue={isEmbedded ? purpose : undefined}
              dragNoteId={note.id}
            />
          {/if}
        {/each}
      </div>
    {/if}

    {#if shownMoods.length > 0 || modulePicker.noteId === note.id && modulePicker.kind === "mood"}
      <MoodRow {note} />
    {/if}

    {#if dropMessage}
      <span class="module-drop-message" data-selection-ignore role="status">{dropMessage}</span>
    {/if}

    {#if pickerKind === "importance"}
      <ModulePicker
        title="Importance"
        mode="single"
        options={IMPORTANCE_OPTIONS}
        selected={pickerImportance ? [pickerImportance] : []}
        onSelect={chooseImportance}
        onClose={closeModulePicker}
        onRemove={importanceIsExternal ? undefined : () => setImportance(note.id, null)}
        deferred={importanceIsExternal}
        description={importanceIsExternal ? "Changing the linked module affects every connected note." : undefined}
        confirmLabel={importanceIsExternal ? "Change shared module" : undefined}
        onConfirm={importanceIsExternal ? changeLinkedImportance : undefined}
        makeLocalLabel={importanceIsExternal ? "Make local" : undefined}
        onMakeLocal={importanceIsExternal ? localizeImportance : undefined}
      />
    {:else if pickerKind === "purpose"}
      <ModulePicker
        title="Purpose"
        mode="multiple"
        options={PURPOSE_OPTIONS}
        selected={note.purposes ?? []}
        onSelect={choosePurpose}
        onClose={closeModulePicker}
      />
    {/if}
  </div>
{/if}
