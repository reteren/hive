import { board } from "../model/board.svelte";
import { addLink, canLink, links, removeLink, updateLink } from "../model/links.svelte";
import { ME_OBJECT_ID, type Link } from "../model/link";
import { execute } from "../history/history.svelte";
import { clearSelection } from "../selection/selection.svelte";
import { clearSelectedLink, selectedLinkIds, selectLink, selectLinks } from "./selection.svelte";
import { nextLineShape } from "./lineGeometry";
import { effectiveLinkKind } from "./rules";

export function createBoardLink(link: Link): boolean {
  const actualKind = effectiveLinkKind(link.from, link.to, link.kind);
  const createdLink = actualKind === link.kind ? link : { ...link, kind: actualKind };
  const source = link.from === ME_OBJECT_ID ? "ME" : board.notes[link.from]?.name;
  const target = board.notes[link.to]?.name;
  if (!canLink(link.from, link.to, actualKind) || !source || !target) return false;

  execute({
    label: "Link",
    target: `${source} → ${target}`,
    do: () => {
      addLink(createdLink);
      clearSelection();
      selectLink(createdLink.id);
    },
    undo: () => {
      removeLink(createdLink.id);
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
  const ids = selectedLinkIds();
  if (ids.length === 0) return false;
  if (ids.length === 1) return unlink(ids[0]);
  return unlinkLinks(ids);
}

export function changeLinkShape(id: string, shape: Link["shape"]): boolean {
  const link = links.byId[id];
  if (!link || link.shape === shape) return false;
  return applyLineShapeChanges([{ link: { ...link }, previousShape: link.shape, nextShape: shape }]);
}

/** Advance each selected line once, preserving the single-line T behaviour. */
export function cycleLinkShapes(ids: readonly string[]): boolean {
  const seen = new Set<string>();
  const changed = ids.flatMap((id) => {
    const link = links.byId[id];
    if (!link || seen.has(id)) return [];
    seen.add(id);
    return [{ link: { ...link }, previousShape: link.shape, nextShape: nextLineShape(link.shape) }];
  });
  return applyLineShapeChanges(changed);
}

function applyLineShapeChanges(
  changed: Array<{ link: Link; previousShape: Link["shape"]; nextShape: Link["shape"] }>,
): boolean {
  if (changed.length === 0) return false;
  const target = changed.length === 1
    ? `${objectName(changed[0].link.from)} → ${objectName(changed[0].link.to)}`
    : `${changed.length} lines`;
  execute({
    label: "Line shape",
    target,
    do: () => {
      for (const { link, nextShape } of changed) updateLink(link.id, { shape: nextShape });
    },
    undo: () => {
      for (const { link, previousShape } of changed) updateLink(link.id, { shape: previousShape });
    },
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

  const selectedBeforeCut = selectedLinkIds();
  const target = cut.length === 1
    ? `${objectName(cut[0].from)} → ${objectName(cut[0].to)}`
    : `${cut.length} lines`;
  const cutIds = new Set(cut.map((link) => link.id));

  execute({
    label: "Cut lines",
    target,
    do: () => {
      for (const link of cut) removeLink(link.id);
      const remainingSelection = selectedLinkIds().filter((id) => !cutIds.has(id));
      if (remainingSelection.length > 0) selectLinks(remainingSelection);
      else if (selectedBeforeCut.some((id) => cutIds.has(id))) clearSelectedLink();
    },
    undo: () => {
      for (const link of cut) addLink({ ...link });
      if (selectedBeforeCut.some((id) => cutIds.has(id))) selectLinks(selectedBeforeCut);
    },
  });
  return true;
}

function unlinkLinks(ids: readonly string[]): boolean {
  const selectedBeforeUnlink = selectedLinkIds();
  const unlinked = ids.flatMap((id) => {
    const link = links.byId[id];
    return link ? [{ ...link }] : [];
  });
  if (unlinked.length === 0) return false;
  const target = unlinked.length === 1
    ? `${objectName(unlinked[0].from)} → ${objectName(unlinked[0].to)}`
    : `${unlinked.length} lines`;
  const unlinkedIds = new Set(unlinked.map((link) => link.id));

  execute({
    label: "Unlink lines",
    target,
    do: () => {
      for (const link of unlinked) removeLink(link.id);
      const remaining = selectedLinkIds().filter((id) => !unlinkedIds.has(id));
      if (remaining.length > 0) selectLinks(remaining);
      else clearSelectedLink();
    },
    undo: () => {
      for (const link of unlinked) addLink({ ...link });
      selectLinks(selectedBeforeUnlink);
    },
  });
  return true;
}

function objectName(id: string): string {
  return id === ME_OBJECT_ID ? "ME" : board.notes[id]?.name ?? "Note";
}
