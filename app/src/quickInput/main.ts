import { mount } from "svelte";
import "../styles/theme.css";
import QuickInput from "./QuickInput.svelte";
import { bootLanguage } from "../i18n/i18n.svelte";
import { followCachedTheme } from "../theme/appearance.svelte";

followCachedTheme();
await bootLanguage();

const target = document.getElementById("app");

if (!target) {
  throw new Error("quick input root element not found");
}

mount(QuickInput, { target });
