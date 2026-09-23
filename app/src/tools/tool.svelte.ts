/**
 * The active board tool. "select" is the default pointer behaviour (R1.4); line tools are R2.
 * T means "search" in select mode and "cycle line shape" inside a line tool (roadmap R2.3/R2.4).
 */
export type ToolId = "select" | "line-strong" | "line-weak" | "line-cut";

export const tool: { active: ToolId } = $state({ active: "select" });

export function isLineTool(id: ToolId = tool.active): boolean {
  return id === "line-strong" || id === "line-weak" || id === "line-cut";
}
