<script lang="ts">
  import { onMount } from "svelte";
  import { invoke } from "@tauri-apps/api/core";
  import { t } from "../../i18n/i18n.svelte";

  /** Mirrors mcp_agents.rs AgentStatus. */
  interface AgentStatus {
    id: string;
    name: string;
    detected: boolean;
    state: "configured" | "other" | "none";
    configPath: string;
    currentCommand: string | null;
  }

  interface CommandInfo {
    command: string;
    args: string[];
    json: string;
  }

  let agents = $state<AgentStatus[]>([]);
  let info = $state<CommandInfo | null>(null);
  let busyId = $state<string | null>(null);
  let error = $state("");
  let copied = $state(false);
  let loading = $state(true);

  async function refresh(): Promise<void> {
    try {
      [agents, info] = await Promise.all([
        invoke<AgentStatus[]>("mcp_agents_list"),
        invoke<CommandInfo>("mcp_command_info"),
      ]);
      error = "";
    } catch (cause) {
      error = t("Could not read the AI agents' settings: {message}", { message: String(cause) });
    } finally {
      loading = false;
    }
  }

  async function configure(agent: AgentStatus, enable: boolean): Promise<void> {
    busyId = agent.id;
    error = "";
    try {
      const next = await invoke<AgentStatus>("mcp_agent_configure", { id: agent.id, enable });
      agents = agents.map((entry) => (entry.id === next.id ? next : entry));
    } catch (cause) {
      error = t("{name}: {message}", { name: agent.name, message: String(cause) });
    } finally {
      busyId = null;
    }
  }

  async function copyConfig(): Promise<void> {
    if (!info) return;
    try {
      await navigator.clipboard.writeText(info.json);
      copied = true;
      setTimeout(() => { copied = false; }, 1600);
    } catch {
      error = t("Could not copy to the clipboard.");
    }
  }

  function stateLabel(agent: AgentStatus): string {
    if (agent.state === "configured") return t("Connected");
    if (agent.state === "other") return t("Uses another hive server");
    return agent.detected ? t("Not connected") : t("Not installed");
  }

  onMount(() => { void refresh(); });
</script>

<section class="settings-block" aria-labelledby="mcp-agents-title" data-mcp-agents>
  <div class="settings-block-header">
    <h3 id="mcp-agents-title" class="settings-block-title">{t("AI agents")}</h3>
    <button class="settings-button" type="button" onclick={() => void refresh()} disabled={loading || busyId !== null}>{t("Refresh")}</button>
  </div>
  <div class="settings-group">
    {#each agents as agent (agent.id)}
      <div class="setting-row is-compact" data-mcp-agent={agent.id}>
        <span class="setting-copy">
          <span class="setting-title">{agent.name}</span>
          <span class="setting-description agent-path" title={agent.currentCommand ?? agent.configPath}>{agent.configPath}</span>
        </span>
        <span class="setting-control">
          <span class="settings-pill" class:is-on={agent.state === "configured"} data-mcp-agent-state={agent.state}>{stateLabel(agent)}</span>
          {#if agent.state === "configured"}
            <button class="settings-button" type="button" disabled={busyId !== null} onclick={() => void configure(agent, false)}>
              {busyId === agent.id ? t("Working…") : t("Remove")}
            </button>
          {:else}
            <button class="settings-button" type="button" disabled={busyId !== null || !agent.detected} onclick={() => void configure(agent, true)}>
              {busyId === agent.id ? t("Working…") : t("Configure")}
            </button>
          {/if}
        </span>
      </div>
    {/each}
    {#if loading}
      <div class="setting-row is-compact"><span class="setting-description">{t("Looking for AI agents…")}</span></div>
    {/if}
    <div class="setting-row is-compact">
      <span class="setting-copy">
        <span class="setting-title">{t("Other agents")}</span>
        <span class="setting-description agent-path" title={info ? `${info.command} ${info.args.join(" ")}` : ""}>
          {info ? `"${info.command}" ${info.args.join(" ")}` : "…"}
        </span>
      </span>
      <button class="settings-button" type="button" disabled={!info} onclick={() => void copyConfig()}>{copied ? t("Copied") : t("Copy config")}</button>
    </div>
  </div>
  {#if error}<p class="settings-error" role="alert">{error}</p>{/if}
  <p class="setting-hint">{t("hive itself is the MCP server: agents start hive.exe in MCP mode, which talks to the running hive. Restart the agent after connecting it. Before changing an agent's config file hive keeps the old one as a .hive-backup copy.")}</p>
</section>

<style>
  .agent-path {
    overflow: hidden;
    max-width: 320px;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
</style>
