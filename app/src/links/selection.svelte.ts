export const selectedLink = $state({ id: null as string | null });

export function selectLink(id: string): void {
  selectedLink.id = id;
}

export function clearSelectedLink(): void {
  selectedLink.id = null;
}
