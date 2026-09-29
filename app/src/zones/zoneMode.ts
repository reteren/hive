import type { ToolId } from "../tools/tool.svelte";

export type ZoneToolMode = "brush" | "move";

export function toggleZoneToolMode(mode: ZoneToolMode): ZoneToolMode {
  return mode === "brush" ? "move" : "brush";
}

export function shouldShowZoneBrushCursor(tool: ToolId, mode: ZoneToolMode, hasCursor: boolean, followMoveActive = false): boolean {
  return tool === "zone" && mode === "brush" && hasCursor && !followMoveActive;
}

/** Board notes are passive while the zone brush is active, including their editable text. */
export function shouldIgnoreZoneBrushTarget(insideNote: boolean, textTarget: boolean, interfaceTarget: boolean): boolean {
  return !insideNote && (textTarget || interfaceTarget);
}
