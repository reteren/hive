import { invoke, isTauri } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import "./methods";
import { dispatchMcpRequest, toMcpErrorPayload, type McpRequest } from "./dispatcher";
import { setMcpBridgeStatus } from "./bridge.svelte";

interface BridgeStatus {
  enabled: boolean;
  port: number | null;
}

let unlistenRequest: UnlistenFn | null = null;
let requestQueue: Promise<void> = Promise.resolve();

async function installRequestListener(): Promise<void> {
  if (unlistenRequest) return;
  unlistenRequest = await listen<McpRequest>("hive://mcp-request", ({ payload }) => {
    requestQueue = requestQueue.then(() => handleRequest(payload)).catch((error: unknown) => {
      console.error("MCP request queue failed.", error);
    });
  });
}

async function handleRequest(request: McpRequest): Promise<void> {
  try {
    const result = await dispatchMcpRequest(request);
    await invoke("mcp_respond", { requestId: request.requestId, ok: true, payload: result });
  } catch (error) {
    const payload = toMcpErrorPayload(error);
    try {
      await invoke("mcp_respond", { requestId: request.requestId, ok: false, payload });
    } catch (responseError) {
      console.warn("Could not return an MCP error response.", responseError);
    }
  }
}

/** Start or stop the Rust listener after the frontend request listener is ready. */
export async function setMcpBridgeEnabled(enabled: boolean): Promise<void> {
  if (!isTauri()) {
    setMcpBridgeStatus(false, null);
    return;
  }

  if (enabled) await installRequestListener();
  try {
    const status = await invoke<BridgeStatus>("mcp_bridge_set_enabled", { enabled });
    if (enabled) await invoke("mcp_bridge_ready");
    else {
      unlistenRequest?.();
      unlistenRequest = null;
    }
    setMcpBridgeStatus(status.enabled, status.port);
  } catch (error) {
    if (enabled) {
      unlistenRequest?.();
      unlistenRequest = null;
    }
    setMcpBridgeStatus(false, null);
    throw error;
  }
}

export async function initializeMcpBridge(enabled: boolean): Promise<void> {
  try {
    await setMcpBridgeEnabled(enabled);
  } catch (error) {
    console.error("Could not initialize the MCP bridge.", error);
  }
}
