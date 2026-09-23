/** Which note's body currently has the live text editor, if any (R1.1/R1.3). */
export const editing: { noteId: string | null } = $state({ noteId: null });
