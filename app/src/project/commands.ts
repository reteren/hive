import { registerCommand } from "../commands/registry.svelte";
import { chooseProject, closeProjectMenu } from "./persistence.svelte";

registerCommand({
  id: "project.new",
  label: "New Project",
  keys: ["Ctrl+Shift+KeyN"],
  run: () => {
    closeProjectMenu();
    void chooseProject("new");
  },
});

registerCommand({
  id: "project.open",
  label: "Open Project",
  keys: ["Ctrl+KeyO"],
  run: () => {
    closeProjectMenu();
    void chooseProject("open");
  },
});
