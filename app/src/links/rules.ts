import { ME_OBJECT_ID, pairKey, type Link } from "../model/link";

/** Pair occupancy is direction and kind independent; this deliberately permits cycles. */
export function canCreateLinkPair(from: string, to: string, existing: readonly Pick<Link, "from" | "to">[]): boolean {
  return from !== to && to !== ME_OBJECT_ID &&
    !existing.some((link) => pairKey(link.from, link.to) === pairKey(from, to));
}
