import {
  abortHistoryTransaction,
  beginHistoryTransaction,
  commitHistoryTransaction,
} from "../history/history.svelte";
import { getMcpMethod, mcpMethodNames, McpError, asParams, type McpMethod } from "./registry";
import { currentObjectIds } from "./idUniverse";
import { createIdIndex, expandParamIds, shortenIds } from "./shortIds";

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

/**
 * Run one bridge request. Params may name objects by short id (see shortIds.ts); the result and
 * error data name them by short id, computed over the objects that existed before or after the call
 * so ids of just-deleted objects shrink too.
 */
export async function dispatchMcpRequest(request: Pick<McpRequest, "method" | "params">): Promise<unknown> {
  const method = getMcpMethod(request.method);
  if (!method) {
    const names = mcpMethodNames();
    const suffix = names.length > 0 ? ` Available methods: ${names.join(", ")}.` : " No methods are registered yet.";
    throw new McpError("unsupported", `Method '${request.method}' is not supported.${suffix}`, names);
  }

  const idsBefore = currentObjectIds();
  const shorten = <T>(value: T): T => shortenIds(value, createIdIndex([...idsBefore, ...currentObjectIds()]));
  try {
    const params = expandParamIds(asParams(request.params), createIdIndex(idsBefore));
    return shorten(await runMethod(method, params));
  } catch (error) {
    if (error instanceof McpError && error.data !== undefined) throw new McpError(error.code, error.message, shorten(error.data));
    throw error;
  }
}

async function runMethod(method: McpMethod, params: Record<string, unknown>): Promise<unknown> {
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
