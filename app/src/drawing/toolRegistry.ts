import type { DrawTool, DrawToolHandler } from "./types";

const handlers = new Map<DrawTool, DrawToolHandler>();

/** Register the handler that implements a draw tool (see the contract in types.ts). */
export function registerDrawTool(tool: DrawTool, handler: DrawToolHandler): () => void {
  handlers.set(tool, handler);
  return () => {
    if (handlers.get(tool) === handler) handlers.delete(tool);
  };
}

export function drawToolHandler(tool: DrawTool): DrawToolHandler | undefined {
  return handlers.get(tool);
}
