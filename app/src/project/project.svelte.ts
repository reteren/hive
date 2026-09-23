export interface ProjectConflict {
  noteId: string;
  noteName: string;
  file: string;
  localText: string;
  externalText: string;
  localCopyFile: string | null;
  externalCopyFile: string | null;
  savingCopies: boolean;
  copyError: string;
}

export const project = $state({
  path: "",
  name: "No project",
  ready: false,
  saving: false,
  error: "",
  warnings: [] as string[],
  conflicts: [] as ProjectConflict[],
  menuOpen: false,
});
