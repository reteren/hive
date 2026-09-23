/** The permanent id for the user's fixed ME beacon. */
export const ME_OBJECT_ID = "me";

export interface LinkAnchor {
  /** Horizontal position in the linked object's bounds, normalised to 0..1. */
  x: number;
  /** Vertical position in the linked object's bounds, normalised to 0..1. */
  y: number;
}

export type LineShape = "straight" | "curved" | "orthogonal" | "wave" | "zigzag";

/**
 * A line between two board objects (R2). At most one link exists per unordered pair
 * of objects, whatever its direction or kind (roadmap R2.2); self-links are not allowed.
 */
export interface Link {
  /** Permanent id. */
  id: string;
  /** Source object id (the arrow starts here). */
  from: string;
  /** Target object id (the arrow ends here). */
  to: string;
  /** "strong" — directed line (C); "weak" — dashed, purely visual line (V). */
  kind: "strong" | "weak";
  /** Line shape, switched with T inside the line tool (R2.3). */
  shape: LineShape;
  /** Optional normalised frame attachment; absent on older board data. */
  fromAnchor?: LinkAnchor;
  /** Optional normalised frame attachment; absent on older board data. */
  toAnchor?: LinkAnchor;
}

/** Order-independent key of the pair a link occupies. */
export function pairKey(a: string, b: string): string {
  return a < b ? `${a}|${b}` : `${b}|${a}`;
}
