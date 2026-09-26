import type { ToolId } from "../tools/tool.svelte";

export type ZoneToolMode = "brush" | "move";

export function toggleZoneToolMode(mode: ZoneToolMode): ZoneToolMode {
  return mode === "brush" ? "move" : "brush";
}

export function shouldShowZoneBrushCursor(tool: ToolId, mode: ZoneToolMode, hasCursor: boolean): boolean {
  return tool === "zone" && mode === "brush" && hasCursor;
}
