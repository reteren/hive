<script lang="ts">
  import TasksPanel from "../../tasks/TasksPanel.svelte";
  import PanelPopup from "./PanelPopup.svelte";
  import { t } from "../../i18n/i18n.svelte";
</script>

<PanelPopup id="tasks" title={t("Tasks")}>
  <TasksPanel variant="popup" />
</PanelPopup>
