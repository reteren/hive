import { mount } from "svelte";
import App from "./App.svelte";
import "./styles/theme.css";
import "./board/cameraCommands";
import "./board/gridCommands";
import { initializeViewSettingsPersistence } from "./settings/persistence.svelte";

await initializeViewSettingsPersistence();

const target = document.getElementById("app");

if (!target) {
  throw new Error("hive root element not found");
}

mount(App, { target });
