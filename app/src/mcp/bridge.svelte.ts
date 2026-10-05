export const mcpBridge = $state({
  enabled: false,
  port: null as number | null,
});

export function setMcpBridgeStatus(enabled: boolean, port: number | null): void {
  mcpBridge.enabled = enabled;
  mcpBridge.port = port;
}

export function mcpBridgeStatusText(): string {
  return mcpBridge.enabled && mcpBridge.port !== null
    ? `Listening on 127.0.0.1:${mcpBridge.port}`
    : "Off";
}
