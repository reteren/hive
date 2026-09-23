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
  shape: "straight" | "curved" | "orthogonal";
}

/** Order-independent key of the pair a link occupies. */
export function pairKey(a: string, b: string): string {
  return a < b ? `${a}|${b}` : `${b}|${a}`;
}
