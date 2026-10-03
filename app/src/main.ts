import { mount } from "svelte";
import App from "./App.svelte";
import "./styles/theme.css";
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
import { initializeProjectPersistence } from "./project/persistence.svelte";
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
import "./inbox/init";
import "./time/uiInit";
import "./messages/init";
import "./time/init";
import "./drawing/init";

await initializeViewSettingsPersistence();
await initializeProjectPersistence();

initializeTransfer();

const target = document.getElementById("app");

if (!target) {
  throw new Error("hive root element not found");
}

mount(App, { target });
