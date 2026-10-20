<script lang="ts">
  import ObjectsPanel from "../../navigation/ObjectsPanel.svelte";
  import PanelPopup from "./PanelPopup.svelte";
  import { t } from "../../i18n/i18n.svelte";
</script>

<PanelPopup id="objects" title={t("Objects")}>
  <ObjectsPanel variant="popup" />
</PanelPopup>
