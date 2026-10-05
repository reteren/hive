<script lang="ts">
  import TasksPanel from "../../tasks/TasksPanel.svelte";
  import PanelPopup from "./PanelPopup.svelte";
</script>

<PanelPopup id="tasks" title="Tasks">
  <TasksPanel variant="popup" />
</PanelPopup>
