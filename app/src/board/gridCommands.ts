import { registerCommand } from "../commands/registry.svelte";
import { decreaseGridStep, grid, increaseGridStep } from "./grid.svelte";

registerCommand({
  id: "grid.toggleShow",
  label: "Toggle Grid",
  keys: ["Shift+KeyG"],
  run: () => {
    grid.showGrid = !grid.showGrid;
  },
  isActive: () => grid.showGrid,
});

registerCommand({
  id: "grid.toggleSnap",
  label: "Toggle Snapgrid",
  keys: ["Alt+KeyS"],
  run: () => {
    grid.snap = !grid.snap;
  },
  isActive: () => grid.snap,
});

registerCommand({
  id: "grid.stepUp",
  label: "Increase Grid Step",
  keys: ["BracketRight"],
  run: increaseGridStep,
});

registerCommand({
  id: "grid.stepDown",
  label: "Decrease Grid Step",
  keys: ["BracketLeft"],
  run: decreaseGridStep,
});
