export const project = $state({
  path: "",
  name: "No project",
  ready: false,
  saving: false,
  error: "",
  warnings: [] as string[],
  menuOpen: false,
});
