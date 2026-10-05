import {
  abortHistoryTransaction,
  beginHistoryTransaction,
  commitHistoryTransaction,
} from "../history/history.svelte";
import { getMcpMethod, mcpMethodNames, McpError, asParams } from "./registry";

export interface McpRequest {
  requestId: string;
  method: string;
  params: unknown;
}

export interface McpErrorPayload {
  code: string;
  message: string;
  data?: unknown;
}

export async function dispatchMcpRequest(request: Pick<McpRequest, "method" | "params">): Promise<unknown> {
  const method = getMcpMethod(request.method);
  if (!method) {
    const names = mcpMethodNames();
    const suffix = names.length > 0 ? ` Available methods: ${names.join(", ")}.` : " No methods are registered yet.";
    throw new McpError("unsupported", `Method '${request.method}' is not supported.${suffix}`, names);
  }

  const params = asParams(request.params);
  if (!method.mutating) return await method.run(params);

  const label = method.label?.(params) || method.name;
  beginHistoryTransaction(`MCP: ${label}`);
  try {
    const result = await method.run(params);
    commitHistoryTransaction();
    return result;
  } catch (error) {
    try {
      abortHistoryTransaction();
    } catch (rollbackError) {
      console.error("MCP history transaction rollback failed.", rollbackError);
      throw new McpError(
        "internal",
        "The MCP operation failed and its changes could not be fully rolled back.",
        { cause: String(error), rollback: String(rollbackError) },
      );
    }
    throw error;
  }
}

export function toMcpErrorPayload(error: unknown): McpErrorPayload {
  if (error instanceof McpError) {
    return { code: error.code, message: error.message, ...(error.data === undefined ? {} : { data: error.data }) };
  }
  console.error("Unexpected MCP method error.", error);
  return { code: "internal", message: "The operation failed unexpectedly. Check the hive log and try again." };
}
