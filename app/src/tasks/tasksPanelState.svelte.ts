export const tasksPanel = $state({
  open: false,
  historyOpen: false,
});

export function toggleTasksPanel(): void {
  tasksPanel.open = !tasksPanel.open;
}

export function closeTasksPanel(): void {
  tasksPanel.open = false;
}
