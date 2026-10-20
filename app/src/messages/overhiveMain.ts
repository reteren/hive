import { mount } from "svelte";
import Overhive from "./Overhive.svelte";
import { bootLanguage } from "../i18n/i18n.svelte";
await bootLanguage();
const target = document.getElementById("app");
if (!target) throw new Error("Overhive root element not found");
mount(Overhive, { target });
