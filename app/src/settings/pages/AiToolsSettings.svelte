<script lang="ts">
  import SettingToggle from "../SettingToggle.svelte";
  import { preferences, setAllowAiToolsMcp } from "../preferences.svelte";
  import { setMcpBridgeEnabled } from "../../mcp/bridge";
  import { mcpBridge } from "../../mcp/bridge.svelte";
  import { t } from "../../i18n/i18n.svelte";

  let mcpSettingBusy = $state(false);
  let mcpSettingError = $state("");
  const listening = $derived(mcpBridge.enabled && mcpBridge.port !== null);

  async function changeMcpSetting(enabled: boolean): Promise<void> {
    mcpSettingBusy = true;
    mcpSettingError = "";
    try {
      await setMcpBridgeEnabled(enabled);
      setAllowAiToolsMcp(enabled);
    } catch (error) {
      mcpSettingError = t("Could not update the MCP bridge. Check the hive log and try again.");
      console.error("Could not update the MCP bridge setting.", error);
    } finally {
      mcpSettingBusy = false;
    }
  }
</script>

<section class="settings-block" aria-labelledby="ai-tools-settings-title" data-ai-tools-settings>
  <div class="settings-block-header"><h3 id="ai-tools-settings-title" class="settings-block-title">{t("MCP bridge")}</h3></div>
  <div class="settings-group">
    <SettingToggle
      label={t("Allow AI tools (MCP)")}
      description={t("Let local AI clients read and edit the open hive project.")}
      checked={preferences.allowAiToolsMcp}
      disabled={mcpSettingBusy}
      data-allow-ai-tools-mcp
      onchange={(enabled) => void changeMcpSetting(enabled)}
    />
    <div class="setting-row is-compact">
      <span class="setting-title">{t("Status")}</span>
      <span class="settings-pill" class:is-on={listening} data-mcp-bridge-status aria-live="polite">
        {listening ? t("Listening on 127.0.0.1:{port}", { port: mcpBridge.port }) : t("Off")}
      </span>
    </div>
    {#if mcpSettingError}<p class="settings-error" role="alert">{mcpSettingError}</p>{/if}
  </div>
  <p class="setting-hint">{t("Only programs on this computer can connect. Every change they make is one undo step, labelled “MCP”.")}</p>
</section>
