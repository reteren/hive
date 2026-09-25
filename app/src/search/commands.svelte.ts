import { registerCommand } from "../commands/registry.svelte";
import { openSearch, searchState } from "./search.svelte";

registerCommand({
  id: "search.open",
  label: "Search notes",
  keys: ["Ctrl+KeyT"],
  run: openSearch,
  isActive: () => searchState.open,
});
