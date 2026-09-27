import { mount } from "svelte";
import "../styles/theme.css";
import QuickInput from "./QuickInput.svelte";

const target = document.getElementById("app");

if (!target) {
  throw new Error("quick input root element not found");
}

mount(QuickInput, { target });
