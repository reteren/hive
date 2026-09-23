import { board } from "../model/board.svelte";
import { addLink, canLink, links, removeLink, updateLink } from "../model/links.svelte";
import { ME_OBJECT_ID, type Link } from "../model/link";
import { execute } from "../history/history.svelte";
import { clearSelection } from "../selection/selection.svelte";
import { clearSelectedLink, selectedLink, selectLink } from "./selection.svelte";

export function createBoardLink(link: Link): boolean {
  const source = link.from === ME_OBJECT_ID ? "ME" : board.notes[link.from]?.name;
  const target = board.notes[link.to]?.name;
  if (!canLink(link.from, link.to) || !source || !target) return false;

  execute({
    label: "Link",
    target: `${source} → ${target}`,
    do: () => {
      addLink(link);
      clearSelection();
      selectLink(link.id);
    },
    undo: () => {
      removeLink(link.id);
      clearSelectedLink();
    },
  });
  return true;
}

export function unlink(id: string): boolean {
  const link = links.byId[id];
  if (!link) return false;
  const target = `${objectName(link.from)} → ${objectName(link.to)}`;

  execute({
    label: "Unlink",
    target,
    do: () => {
      removeLink(id);
      clearSelectedLink();
    },
    undo: () => {
      addLink(link);
      clearSelection();
      selectLink(id);
    },
  });
  return true;
}

export function unlinkSelected(): boolean {
  return selectedLink.id ? unlink(selectedLink.id) : false;
}

export function changeLinkShape(id: string, shape: Link["shape"]): boolean {
  const link = links.byId[id];
  if (!link || link.shape === shape) return false;

  const previousShape = link.shape;
  const target = `${objectName(link.from)} → ${objectName(link.to)}`;
  execute({
    label: "Line shape",
    target,
    do: () => updateLink(id, { shape }),
    undo: () => updateLink(id, { shape: previousShape }),
  });
  return true;
}

/** Remove a set of links as one history operation and retain their complete serialized values. */
export function cutLinks(ids: readonly string[]): boolean {
  const seen = new Set<string>();
  const cut = ids.flatMap((id) => {
    const link = links.byId[id];
    if (!link || seen.has(id)) return [];
    seen.add(id);
    return [{ ...link }];
  });
  if (cut.length === 0) return false;

  const selectedBeforeCut = selectedLink.id;
  const target = cut.length === 1
    ? `${objectName(cut[0].from)} → ${objectName(cut[0].to)}`
    : `${cut.length} lines`;
  const cutIds = new Set(cut.map((link) => link.id));

  execute({
    label: "Cut lines",
    target,
    do: () => {
      for (const link of cut) removeLink(link.id);
      if (selectedLink.id && cutIds.has(selectedLink.id)) clearSelectedLink();
    },
    undo: () => {
      for (const link of cut) addLink({ ...link });
      if (selectedBeforeCut && cutIds.has(selectedBeforeCut)) selectLink(selectedBeforeCut);
    },
  });
  return true;
}

function objectName(id: string): string {
  return id === ME_OBJECT_ID ? "ME" : board.notes[id]?.name ?? "Note";
}
