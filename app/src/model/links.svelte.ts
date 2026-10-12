import { pairKey, type Link } from "./link";
import { canCreateLinkPair, linkRefusalReason as getLinkRefusalReason } from "../links/rules";
import { tool } from "../tools/tool.svelte";

/**
 * Links of the open board. Raw mutations like board.svelte.ts: user-facing changes go
 * through history commands.
 */
export const links = $state({
  byId: {} as Record<string, Link>,
});

export interface LinkLifecycleListener {
  onRemoved?(link: Link): void;
  onRestored?(link: Link): void;
}

const lifecycleListeners = new Set<LinkLifecycleListener>();
const mutationListeners = new Set<(ids: readonly string[] | null, topologyChanged: boolean) => void>();
const linksByObject = new Map<string, Link[]>();
const linkOrder = new Map<string, number>();
let nextLinkOrder = 0;
let revision = 0;

/** Subscribe to link changes; listeners should only record dirty ids and schedule work. */
export function onLinksMutation(listener: (ids: readonly string[] | null, topologyChanged: boolean) => void): () => void {
  mutationListeners.add(listener);
  return () => mutationListeners.delete(listener);
}

function notifyLinksMutation(ids: readonly string[] | null, topologyChanged: boolean): void {
  revision += 1;
  for (const listener of mutationListeners) listener(ids, topologyChanged);
}

/** Non-reactive revision for cheap autosave dirty checks. */
export function linksRevision(): number {
  return revision;
}

function insertByOrder(list: Link[], link: Link, order: number): void {
  let low = 0;
  let high = list.length;
  while (low < high) {
    const middle = (low + high) >>> 1;
    if ((linkOrder.get(list[middle]!.id) ?? 0) < order) low = middle + 1;
    else high = middle;
  }
  list.splice(low, 0, link);
}

function attachLink(link: Link, order: number): void {
  linkOrder.set(link.id, order);
  for (const objectId of new Set([link.from, link.to])) {
    const list = linksByObject.get(objectId) ?? [];
    insertByOrder(list, link, order);
    linksByObject.set(objectId, list);
  }
}

function detachLink(link: Link): void {
  for (const objectId of new Set([link.from, link.to])) {
    const list = linksByObject.get(objectId);
    if (!list) continue;
    const index = list.findIndex((candidate) => candidate.id === link.id);
    if (index !== -1) list.splice(index, 1);
    if (list.length === 0) linksByObject.delete(objectId);
  }
}

/** Observe raw link mutations while they are still inside their owning history command. */
export function registerLinkLifecycle(listener: LinkLifecycleListener): () => void {
  lifecycleListeners.add(listener);
  return () => lifecycleListeners.delete(listener);
}

export function linkBetween(a: string, b: string): Link | undefined {
  const key = pairKey(a, b);
  return Object.values(links.byId).find((link) => pairKey(link.from, link.to) === key);
}

/** Whether a new link between a and b is allowed (no self-link, one link per pair). */
export function canLink(a: string, b: string, kind: Link["kind"] = activeLinkKind()): boolean {
  return canCreateLinkPair(a, b, Object.values(links.byId), kind);
}

export function linkRefusalReason(a: string, b: string, kind: Link["kind"] = activeLinkKind()): string | null {
  return getLinkRefusalReason(a, b, kind, Object.values(links.byId));
}

export function addLink(link: Link): void {
  const previous = links.byId[link.id];
  const order = linkOrder.get(link.id) ?? nextLinkOrder++;
  if (previous) detachLink(previous);
  links.byId[link.id] = link;
  attachLink(link, order);
  for (const listener of lifecycleListeners) listener.onRestored?.(link);
  notifyLinksMutation([link.id], true);
}

export function removeLink(id: string): Link | undefined {
  const link = links.byId[id];
  if (link) {
    for (const listener of lifecycleListeners) listener.onRemoved?.(link);
    detachLink(link);
    delete links.byId[id];
    linkOrder.delete(id);
    notifyLinksMutation([id], true);
  }
  return link;
}

export function updateLink(id: string, patch: Partial<Omit<Link, "id">>): void {
  const link = links.byId[id];
  if (!link) return;
  const previousFrom = link.from;
  const previousTo = link.to;
  Object.assign(link, patch);
  if (link.from !== previousFrom || link.to !== previousTo) {
    const order = linkOrder.get(id) ?? nextLinkOrder++;
    detachLink({ ...link, from: previousFrom, to: previousTo });
    attachLink(link, order);
  }
  notifyLinksMutation([id], link.from !== previousFrom || link.to !== previousTo);
}

/** Links touching an object, e.g. to remove and later restore them with a deleted note. */
export function linksOf(objectId: string): Link[] {
  return [...linksByObject.get(objectId) ?? []];
}

export function replaceLinks(next: Link[]): void {
  links.byId = Object.fromEntries(next.map((link) => [link.id, link]));
  linksByObject.clear();
  linkOrder.clear();
  nextLinkOrder = 0;
  for (const link of Object.values(links.byId)) attachLink(link, nextLinkOrder++);
  notifyLinksMutation(null, true);
}

function activeLinkKind(): Link["kind"] {
  return tool.active === "line-weak" ? "weak" : "strong";
}
