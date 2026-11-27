import { board } from "../model/board.svelte";
import { links } from "../model/links.svelte";
import { zones } from "../model/zones.svelte";
import { archive, trash } from "../model/retention.svelte";

/** Every id an MCP agent can name right now: nodes, links, zones, Trash and Archive entries. */
export function currentObjectIds(): string[] {
  return [
    ...Object.keys(board.notes),
    ...Object.keys(links.byId),
    ...Object.keys(zones.byId),
    ...trash.entries.map((entry) => entry.id),
    ...archive.entries.map((entry) => entry.id),
  ];
}
