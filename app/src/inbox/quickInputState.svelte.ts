export const quickInputPrompt = $state({
  open: false,
  text: "",
  error: "",
});

export function openQuickInputPrompt(): void {
  quickInputPrompt.error = "";
  quickInputPrompt.open = true;
}

export function closeQuickInputPrompt(): void {
  quickInputPrompt.open = false;
}
