import type { LineShape } from "../links/shapes";

/**
 * The active board tool. "select" is the default pointer behaviour (R1.4); line tools are R2.
 * T means "search" in select mode and "cycle line shape" inside a line tool (roadmap R2.3/R2.4).
 */
export type ToolId = "select" | "line-strong" | "line-weak" | "zone" | "draw";

export type LineToolId = Extract<ToolId, "line-strong" | "line-weak">;

/** `lastLine` is the line sub-tool the Line button re-enters (strong by default). */
export const tool: { active: ToolId; lineShape: LineShape; lastLine: LineToolId } = $state({
  active: "select",
  lineShape: "base",
  lastLine: "line-strong",
});

export function isLineTool(id: ToolId = tool.active): boolean {
  return id === "line-strong" || id === "line-weak";
}
