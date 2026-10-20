<script lang="ts">
  import UndoLog from "../../ui/UndoLog.svelte";
  import PanelPopup from "./PanelPopup.svelte";
  import { t } from "../../i18n/i18n.svelte";
</script>

<PanelPopup id="undo-log" title={t("Undo history")}>
  <UndoLog variant="popup" />
</PanelPopup>
