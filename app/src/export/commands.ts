import { registerCommand } from "../commands/registry.svelte";
import { exportCurrentProject, importProjectFromZip } from "./actions";

registerCommand({
  id: "project.export",
  label: "Export project…",
  keys: [],
  run: () => void exportCurrentProject(),
});

registerCommand({
  id: "project.importZip",
  label: "Import project from .zip…",
  keys: [],
  run: () => void importProjectFromZip(),
});
