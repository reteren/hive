import { mount } from "svelte";
import App from "./App.svelte";
import "./styles/theme.css";
import "./styles/motion.css";
import "./ui/focusGuard";
import "./tasks/tasks.css";
import "./modules/modules.css";
import "./notes/noteKinds.css";
import "./board/cameraCommands";
import "./board/gridCommands";
import "./clipboard/commands";
import "./project/commands";
import "./scope/init";
import { initializeViewSettingsPersistence } from "./settings/persistence.svelte";
import { applyTheme } from "./theme/appearance.svelte";
import { bootLanguage } from "./i18n/i18n.svelte";
import { syncTrayLabels } from "./i18n/trayLabels.svelte";
import { preferences } from "./settings/preferences.svelte";
import { initializeProjectPersistence } from "./project/persistence.svelte";
import { initializeMcpBridge } from "./mcp/bridge";
import { initializeTransfer } from "./transfer/init";
import "./goal/init";
import "./calculator/init";
import "./tierlist/init";
import "./backup/init";
import "./archive/init";
import "./map/init";
import "./list/init";
import "./random/init";
import "./quickInput/init";
import "./source/init";
import "./spell/init";
import "./info/init";
import "./inbox/init";
import "./time/uiInit";
import "./messages/init";
import "./time/init";
import "./drawing/init";

applyTheme();
await bootLanguage();
syncTrayLabels();
await initializeViewSettingsPersistence();
await initializeProjectPersistence();
await initializeMcpBridge(preferences.allowAiToolsMcp);

initializeTransfer();

const target = document.getElementById("app");

if (!target) {
  throw new Error("hive root element not found");
}

mount(App, { target });
