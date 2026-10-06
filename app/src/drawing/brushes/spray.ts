import { createStroke, type DrawStroke } from "../brush";
import { currentDrawLevel, type BrushSettings, type DrawPointerEvent, type DrawToolHandler, type TileSnapshot } from "../types";
import { drawingSelection } from "../selection.svelte";
import { drawingTools } from "../tools.svelte";
import { registerDrawTool } from "../toolRegistry";
import { captureStrokeBefore, commitFinishedStroke, hideStrokePreview, showStrokePreview } from "../stroke.svelte";
import { createSeededRandom, newSpraySeed, randomSprayDabs, sprayRate } from "./sprayMath";

let activeStroke: DrawStroke | null = null;
let activeSettings: BrushSettings | null = null;
let latest: DrawPointerEvent | null = null;
let random: (() => number) | null = null;
let before: TileSnapshot | null = null;
let frame: number | null = null;
let lastTick = 0;
let remainder = 0;

function publish(): void {
  if (!activeStroke || !activeSettings) return;
  showStrokePreview(activeStroke, { opacity: activeSettings.opacity });
}

function emit(count: number): void {
  if (!activeStroke || !activeSettings || !latest || !random || count <= 0) return;
  const points = randomSprayDabs(
    latest.world,
    activeSettings.size,
    activeSettings.sprayDotSize ?? 3,
    count,
    random,
  );
  activeStroke.addDabs(points);
  before = captureStrokeBefore(activeStroke, before);
  publish();
}

function advance(now: number): void {
  if (!activeStroke || !activeSettings || !latest) return;
  const elapsed = Math.min(250, Math.max(0, now - lastTick)) / 1000;
  lastTick = now;
  remainder += sprayRate(activeSettings.sprayDensity ?? 120, activeSettings.size, latest.pressure) * elapsed;
  const count = Math.min(200, Math.floor(remainder));
  remainder -= count;
  emit(count);
}

function schedule(): void {
  if (!activeStroke || frame !== null) return;
  frame = requestAnimationFrame((now) => {
    frame = null;
    advance(now);
    schedule();
  });
}

function begin(event: DrawPointerEvent): void {
  cancel();
  const requested = { ...drawingTools.brush };
  const settings = { ...requested, sprayDotSize: Math.min(requested.sprayDotSize ?? 3, requested.size) };
  activeSettings = settings;
  const level = currentDrawLevel(event.zoom);
  const dotSettings: BrushSettings = { ...settings, size: settings.sprayDotSize ?? 3, tip: "round" };
  activeStroke = createStroke(dotSettings, event.zoom, level);
  latest = event;
  random = createSeededRandom(newSpraySeed());
  before = new Map();
  remainder = 0;
  lastTick = performance.now();
  emit(1);
  schedule();
}

function move(event: DrawPointerEvent): void {
  if (!activeStroke) return;
  latest = event;
}

async function finish(event: DrawPointerEvent): Promise<void> {
  const stroke = activeStroke;
  const settings = activeSettings;
  if (!stroke || !settings) return;
  latest = event;
  advance(performance.now());
  activeStroke = null;
  activeSettings = null;
  latest = null;
  random = null;
  if (frame !== null) cancelAnimationFrame(frame);
  frame = null;
  const finished = stroke.finish();
  if (!finished) {
    hideStrokePreview(stroke);
    stroke.dispose();
    before = null;
    return;
  }
  const selection = drawingSelection.area;
  const early = before;
  before = null;
  await commitFinishedStroke(stroke, finished, settings, "Spray", selection, early);
}

function cancel(): void {
  if (frame !== null) cancelAnimationFrame(frame);
  frame = null;
  if (activeStroke) {
    hideStrokePreview(activeStroke);
    activeStroke.dispose();
  }
  activeStroke = null;
  activeSettings = null;
  latest = null;
  random = null;
  before = null;
  remainder = 0;
}

export const sprayToolHandler: DrawToolHandler = {
  down: begin,
  move,
  up(event) { void finish(event).catch((error: unknown) => console.error("Spray stroke failed", error)); },
  cancel,
};

registerDrawTool("spray", sprayToolHandler);
