/** Which node's Info window is open (one at a time). */
export const infoWindow = $state<{ noteId: string | null }>({ noteId: null });

export function openNodeInfo(noteId: string): void {
  infoWindow.noteId = noteId;
}

export function closeNodeInfo(): void {
  infoWindow.noteId = null;
}
