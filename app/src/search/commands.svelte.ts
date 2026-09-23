import { isLineTool } from "../tools/tool.svelte";
import { registerCommand, runCommand } from "../commands/registry.svelte";
import { openSearch, searchState } from "./search.svelte";

registerCommand({
  id: "search.open",
  label: "Search notes",
  keys: ["KeyT"],
  run: () => {
    if (isLineTool()) {
      runCommand("line.cycleShape");
      return;
    }
    openSearch();
  },
  isActive: () => searchState.open,
});
