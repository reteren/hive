import type { LinkAnchor } from "../model/link";

export interface LinkDraft {
  sourceId: string;
  sourceAnchor?: LinkAnchor;
}

export interface LinkGestureInput {
  draft: LinkDraft | null;
  clickedId: string;
  clickedAnchor?: LinkAnchor;
  moved: boolean;
  targetId: string | null;
  targetAnchor?: LinkAnchor;
}

export type LinkGestureResult =
  | { kind: "start"; draft: LinkDraft }
  | { kind: "create"; from: string; to: string; fromAnchor?: LinkAnchor; toAnchor?: LinkAnchor }
  | { kind: "cancel" };

/** Resolve click-click and drag-release line gestures without DOM state. */
export function completeLinkGesture(input: LinkGestureInput): LinkGestureResult {
  if (!input.draft) {
    if (!input.moved) {
      return { kind: "start", draft: { sourceId: input.clickedId, sourceAnchor: input.clickedAnchor } };
    }
    return input.targetId
      ? {
          kind: "create",
          from: input.clickedId,
          to: input.targetId,
          fromAnchor: input.clickedAnchor,
          toAnchor: input.targetAnchor,
        }
      : { kind: "cancel" };
  }

  return input.targetId
    ? {
        kind: "create",
        from: input.draft.sourceId,
        to: input.targetId,
        fromAnchor: input.draft.sourceAnchor,
        toAnchor: input.targetAnchor,
      }
    : { kind: "cancel" };
}

export type CutRelease = "ignore" | "cut-link" | "cut-stroke";

export function resolveCutRelease(dragged: boolean, clickedLinkId: string | null): CutRelease {
  if (dragged) return "cut-stroke";
  return clickedLinkId ? "cut-link" : "ignore";
}

export function nextTool(current: string, requested: string): string {
  return current === requested ? "select" : requested;
}
