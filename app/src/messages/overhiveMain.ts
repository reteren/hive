import { mount } from "svelte";
import Overhive from "./Overhive.svelte";
const target = document.getElementById("app");
if (!target) throw new Error("Overhive root element not found");
mount(Overhive, { target });
