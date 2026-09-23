<script lang="ts">
  import { onDestroy } from "svelte";
  import type { ImportanceLevel, Note, PurposeKind } from "../model/note";
  import { noteBounds } from "../notes/layout.svelte";
  import {
    closeModulePicker,
    effectiveImportance,
    effectivePurposes,
    extractModuleFromNote,
    isLinkedImportance,
    linkedPurposes,
    moduleDropPreview,
    moduleFeedback,
    openModulePicker,
    setImportance,
    togglePurpose,
    worldPointFromClient,
  } from "./moduleActions.svelte";
  import { IMPORTANCE_OPTIONS, PURPOSE_OPTIONS, isImportanceLevel, isPurposeKind } from "./moduleLogic";
  import { modulePicker } from "./pickerState.svelte";
  import ModuleChip from "./ModuleChip.svelte";
  import ModulePicker from "./ModulePicker.svelte";
  import "./commands";

  let { note }: { note: Note } = $props();
  let pickerKind = $derived(modulePicker.noteId === note.id ? modulePicker.kind : null);
  let shownImportance = $derived(effectiveImportance(note.id));
  let shownPurposes = $derived(effectivePurposes(note.id));
  let externalPurposes = $derived(linkedPurposes(note.id));
  let importanceIsExternal = $derived(isLinkedImportance(note.id));
  let isDropTarget = $derived(moduleDropPreview.targetId === note.id);
  let dropMessage = $derived(
    moduleDropPreview.moduleId && isDropTarget ? moduleDropPreview.reason :
      moduleFeedback.noteId === note.id ? moduleFeedback.message : null,
  );
  let hasModules = $derived(Boolean(shownImportance) || shownPurposes.length > 0);

  interface ExtractionGesture {
    pointerId: number;
    startX: number;
    startY: number;
    kind: "importance" | "purpose";
    value: ImportanceLevel | PurposeKind;
    dragging: boolean;
  }

  let extractionGesture: ExtractionGesture | null = null;
  let suppressNextClick = false;
  let suppressClickTimer: ReturnType<typeof setTimeout> | undefined;

  function chooseImportance(id: string): void {
    if (isImportanceLevel(id)) setImportance(note.id, id);
  }

  function choosePurpose(id: string): void {
    if (isPurposeKind(id)) togglePurpose(note.id, id);
  }

  function startExtraction(event: PointerEvent, kind: "importance" | "purpose", value: string): void {
    if (event.button !== 0 || extractionGesture) return;
    if (kind === "importance" ? !isImportanceLevel(value) : !isPurposeKind(value)) return;

    extractionGesture = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      kind,
      value: value as ImportanceLevel | PurposeKind,
      dragging: false,
    };
    window.addEventListener("pointermove", onExtractionMove, true);
    window.addEventListener("pointerup", onExtractionEnd, true);
    window.addEventListener("pointercancel", onExtractionCancel, true);
  }

  function onExtractionMove(event: PointerEvent): void {
    const gesture = extractionGesture;
    if (!gesture || gesture.pointerId !== event.pointerId) return;
    if (!gesture.dragging && Math.hypot(event.clientX - gesture.startX, event.clientY - gesture.startY) >= 6) {
      gesture.dragging = true;
    }
    if (gesture.dragging) {
      event.preventDefault();
      event.stopPropagation();
    }
  }

  function onExtractionEnd(event: PointerEvent): void {
    const gesture = extractionGesture;
    if (!gesture || gesture.pointerId !== event.pointerId) return;
    removeExtractionListeners();
    if (!gesture.dragging) return;

    event.preventDefault();
    event.stopPropagation();
    suppressClickAfterDrag();
    const point = worldPointFromClient(event.clientX, event.clientY);
    const bounds = noteBounds(note);
    if (!point || (point.x >= bounds.x && point.x <= bounds.x + bounds.width &&
      point.y >= bounds.y && point.y <= bounds.y + bounds.height)) return;
    extractModuleFromNote(note.id, gesture.kind, gesture.value, point);
  }

  function onExtractionCancel(event: PointerEvent): void {
    if (extractionGesture?.pointerId !== event.pointerId) return;
    removeExtractionListeners();
  }

  function removeExtractionListeners(): void {
    extractionGesture = null;
    window.removeEventListener("pointermove", onExtractionMove, true);
    window.removeEventListener("pointerup", onExtractionEnd, true);
    window.removeEventListener("pointercancel", onExtractionCancel, true);
  }

  function suppressClickAfterDrag(): void {
    suppressNextClick = true;
    if (suppressClickTimer !== undefined) clearTimeout(suppressClickTimer);
    suppressClickTimer = setTimeout(() => {
      suppressNextClick = false;
      suppressClickTimer = undefined;
    }, 120);
  }

  function openPicker(kind: "importance" | "purpose"): void {
    if (suppressNextClick) {
      suppressNextClick = false;
      if (suppressClickTimer !== undefined) clearTimeout(suppressClickTimer);
      suppressClickTimer = undefined;
      return;
    }
    openModulePicker(note.id, kind);
  }

  onDestroy(() => {
    removeExtractionListeners();
    if (suppressClickTimer !== undefined) clearTimeout(suppressClickTimer);
  });
</script>

{#if hasModules || pickerKind || isDropTarget || moduleFeedback.noteId === note.id}
  <div
    class="note-modules"
    data-module-drop-target={isDropTarget ? (moduleDropPreview.allowed ? "allowed" : "refused") : undefined}
  >
    {#if shownImportance}
      {@const option = IMPORTANCE_OPTIONS.find((item) => item.id === shownImportance)}
      {#if option}
        <ModuleChip
          label={option.label}
          color={option.color}
          rainbow={shownImportance === "absolute"}
          linked={importanceIsExternal}
          pressed={pickerKind === "importance"}
          interactive={!importanceIsExternal || note.importance !== undefined && note.importance !== null}
          onClick={() => openPicker("importance")}
          dragKind={note.importance ? "importance" : undefined}
          dragValue={note.importance ?? undefined}
          onPointerDown={(event) => note.importance && startExtraction(event, "importance", note.importance)}
        />
      {/if}
    {/if}

    {#each shownPurposes as purpose (purpose)}
      {@const option = PURPOSE_OPTIONS.find((item) => item.id === purpose)}
      {@const isExternal = externalPurposes.includes(purpose)}
      {@const isEmbedded = note.purposes?.includes(purpose) ?? false}
      {#if option}
        <ModuleChip
          label={option.label}
          color={option.color}
          iconPath={option.iconPath}
          linked={isExternal}
          pressed={pickerKind === "purpose"}
          interactive={isEmbedded || !isExternal}
          onClick={() => openPicker("purpose")}
          dragKind={isEmbedded ? "purpose" : undefined}
          dragValue={isEmbedded ? purpose : undefined}
          onPointerDown={(event) => isEmbedded && startExtraction(event, "purpose", purpose)}
        />
      {/if}
    {/each}

    {#if dropMessage}
      <span class="module-drop-message" data-selection-ignore role="status">{dropMessage}</span>
    {/if}

    {#if pickerKind === "importance"}
      <ModulePicker
        title="Importance"
        mode="single"
        options={IMPORTANCE_OPTIONS}
        selected={shownImportance ? [shownImportance] : []}
        onSelect={chooseImportance}
        onClose={closeModulePicker}
        onRemove={() => setImportance(note.id, null)}
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
