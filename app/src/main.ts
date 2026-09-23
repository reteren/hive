import { mount } from "svelte";
import App from "./App.svelte";
import "./styles/theme.css";
import "./tasks/tasks.css";
import "./modules/modules.css";
import "./notes/noteKinds.css";
import "./board/cameraCommands";
import "./board/gridCommands";
import "./clipboard/commands";
import "./project/commands";
import { initializeViewSettingsPersistence } from "./settings/persistence.svelte";
import { initializeProjectPersistence } from "./project/persistence.svelte";
import { initializeTransfer } from "./transfer/init";

await initializeViewSettingsPersistence();
await initializeProjectPersistence();

initializeTransfer();

const target = document.getElementById("app");

if (!target) {
  throw new Error("hive root element not found");
}

mount(App, { target });
