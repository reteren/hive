export type ModulePickerKind = "importance" | "purpose";

export const modulePicker = $state({
  noteId: null as string | null,
  kind: null as ModulePickerKind | null,
});

export function openModulePicker(noteId: string, kind: ModulePickerKind): void {
  modulePicker.noteId = noteId;
  modulePicker.kind = kind;
}

export function closeModulePicker(): void {
  modulePicker.noteId = null;
  modulePicker.kind = null;
}
