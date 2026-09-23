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
  links.byId[link.id] = link;
}

export function removeLink(id: string): Link | undefined {
  const link = links.byId[id];
  if (link) delete links.byId[id];
  return link;
}

export function updateLink(id: string, patch: Partial<Omit<Link, "id">>): void {
  const link = links.byId[id];
  if (link) Object.assign(link, patch);
}

/** Links touching an object, e.g. to remove and later restore them with a deleted note. */
export function linksOf(objectId: string): Link[] {
  return Object.values(links.byId).filter((link) => link.from === objectId || link.to === objectId);
}

export function replaceLinks(next: Link[]): void {
  links.byId = Object.fromEntries(next.map((link) => [link.id, link]));
}

function activeLinkKind(): Link["kind"] {
  return tool.active === "line-weak" ? "weak" : "strong";
}
