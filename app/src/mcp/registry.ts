/**
 * MCP bridge method registry (contract: docs/handoff/d34_mcp_contract.md).
 * Each area registers its methods from its own module; src/mcp/methods.ts imports them all.
 */

export type McpErrorCode =
  | "unauthorized"
  | "protocol_mismatch"
  | "busy"
  | "timeout"
  | "no_project"
  | "not_found"
  | "invalid_params"
  | "name_conflict"
  | "unsupported"
  | "internal";

/** Expected failure reported to the AI client as `{ code, message, data }`. */
export class McpError extends Error {
  readonly code: McpErrorCode;
  readonly data?: unknown;

  constructor(code: McpErrorCode, message: string, data?: unknown) {
    super(message);
    this.name = "McpError";
    this.code = code;
    this.data = data;
  }
}

export interface McpMethod<P = Record<string, unknown>, R = unknown> {
  name: string;
  /** Board-changing methods run inside one history transaction ("MCP: <label>"). */
  mutating: boolean;
  /** Short lower-case summary for the Undo log, e.g. "create 3 nodes". */
  label?: (params: P) => string;
  run: (params: P) => R | Promise<R>;
}

const methods = new Map<string, McpMethod>();

export function registerMcpMethod<P = Record<string, unknown>, R = unknown>(method: McpMethod<P, R>): void {
  if (methods.has(method.name)) throw new Error(`MCP method ${method.name} is registered twice.`);
  methods.set(method.name, method as unknown as McpMethod);
}

export function getMcpMethod(name: string): McpMethod | undefined {
  return methods.get(name);
}

export function mcpMethodNames(): string[] {
  return [...methods.keys()].sort();
}

/** Params arrive as untrusted JSON: a plain object or nothing. */
export function asParams(value: unknown): Record<string, unknown> {
  if (value === undefined || value === null) return {};
  if (typeof value !== "object" || Array.isArray(value)) {
    throw new McpError("invalid_params", "Params must be a JSON object.");
  }
  return value as Record<string, unknown>;
}
