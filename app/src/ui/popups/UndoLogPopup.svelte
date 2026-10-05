<script lang="ts">
  import UndoLog from "../../ui/UndoLog.svelte";
  import PanelPopup from "./PanelPopup.svelte";
</script>

<PanelPopup id="undo-log" title="Undo history">
  <UndoLog variant="popup" />
</PanelPopup>
