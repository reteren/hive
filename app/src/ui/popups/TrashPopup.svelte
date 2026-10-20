<script lang="ts">
  import TrashPanel from "../../trash/TrashPanel.svelte";
  import PanelPopup from "./PanelPopup.svelte";
  import { t } from "../../i18n/i18n.svelte";
</script>

<PanelPopup id="trash" title={t("Trash")}>
  <TrashPanel variant="popup" />
</PanelPopup>
