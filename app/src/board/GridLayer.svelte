<script lang="ts">
  import { onMount } from "svelte";
  import { PX_PER_UNIT, type Camera, type Size } from "./cameraMath";
  import { camera, viewport } from "./camera.svelte";
  import { gridLineStride, GRID_MAJOR_EVERY } from "./gridMath";
  import { grid } from "./grid.svelte";

  let canvas: HTMLCanvasElement;
  let devicePixelRatio = $state(1);

  onMount(() => {
    const updatePixelRatio = () => {
      devicePixelRatio = window.devicePixelRatio || 1;
    };

    updatePixelRatio();
    window.addEventListener("resize", updatePixelRatio);
    return () => window.removeEventListener("resize", updatePixelRatio);
  });

  $effect(() => {
    const currentCamera: Camera = { x: camera.x, y: camera.y, zoom: camera.zoom };
    const currentViewport: Size = { width: viewport.width, height: viewport.height };
    const currentStep = grid.step;
    const showGrid = grid.showGrid;
    const ratio = devicePixelRatio;

    // Draw in the same update as the DOM layer (ME marker). Deferring to a separate
    // animation frame starved the grid while WASD moved the camera every frame.
    drawGrid(canvas, currentCamera, currentViewport, currentStep, showGrid, ratio);
  });

  function drawGrid(
    target: HTMLCanvasElement,
    currentCamera: Camera,
    currentViewport: Size,
    step: number,
    showGrid: boolean,
    ratio: number,
  ): void {
    const width = Math.max(0, currentViewport.width);
    const height = Math.max(0, currentViewport.height);
    const pixelWidth = Math.round(width * ratio);
    const pixelHeight = Math.round(height * ratio);
    if (target.width !== pixelWidth) target.width = pixelWidth;
    if (target.height !== pixelHeight) target.height = pixelHeight;

    const context = target.getContext("2d");
    if (!context) return;

    context.setTransform(1, 0, 0, 1, 0, 0);
    context.clearRect(0, 0, target.width, target.height);
    if (!showGrid || width === 0 || height === 0 || !Number.isFinite(currentCamera.zoom)) return;
    if (!Number.isFinite(step) || step <= 0 || currentCamera.zoom <= 0) return;

    const styles = getComputedStyle(target);
    const minorColor = styles.getPropertyValue("--grid-minor").trim();
    const majorColor = styles.getPropertyValue("--grid-major").trim();
    const axisColor = styles.getPropertyValue("--axis").trim();
    if (!minorColor || !majorColor || !axisColor) return;

    const pixelsPerUnit = PX_PER_UNIT * currentCamera.zoom;
    const stride = gridLineStride(step, currentCamera.zoom);
    const drawnStep = step * stride;
    if (!Number.isFinite(drawnStep) || drawnStep <= 0) return;

    context.setTransform(ratio, 0, 0, ratio, 0, 0);
    context.lineWidth = 1 / ratio;

    const worldLeft = currentCamera.x - width / (2 * pixelsPerUnit);
    const worldRight = currentCamera.x + width / (2 * pixelsPerUnit);
    const worldTop = currentCamera.y - height / (2 * pixelsPerUnit);
    const worldBottom = currentCamera.y + height / (2 * pixelsPerUnit);
    const firstX = Math.ceil(worldLeft / drawnStep);
    const lastX = Math.floor(worldRight / drawnStep);
    const firstY = Math.ceil(worldTop / drawnStep);
    const lastY = Math.floor(worldBottom / drawnStep);

    context.strokeStyle = minorColor;
    context.beginPath();
    for (let index = firstX; index <= lastX; index += 1) {
      if (index === 0 || (index * stride) % GRID_MAJOR_EVERY === 0) continue;
      const worldX = index * drawnStep;
      const screenX = snapToDevicePixel((worldX - currentCamera.x) * pixelsPerUnit + width / 2, ratio);
      context.moveTo(screenX, 0);
      context.lineTo(screenX, height);
    }
    for (let index = firstY; index <= lastY; index += 1) {
      if (index === 0 || (index * stride) % GRID_MAJOR_EVERY === 0) continue;
      const worldY = index * drawnStep;
      const screenY = snapToDevicePixel((worldY - currentCamera.y) * pixelsPerUnit + height / 2, ratio);
      context.moveTo(0, screenY);
      context.lineTo(width, screenY);
    }
    context.stroke();

    context.strokeStyle = majorColor;
    context.beginPath();
    for (let index = firstX; index <= lastX; index += 1) {
      if (index === 0 || (index * stride) % GRID_MAJOR_EVERY !== 0) continue;
      const worldX = index * drawnStep;
      const screenX = snapToDevicePixel((worldX - currentCamera.x) * pixelsPerUnit + width / 2, ratio);
      context.moveTo(screenX, 0);
      context.lineTo(screenX, height);
    }
    for (let index = firstY; index <= lastY; index += 1) {
      if (index === 0 || (index * stride) % GRID_MAJOR_EVERY !== 0) continue;
      const worldY = index * drawnStep;
      const screenY = snapToDevicePixel((worldY - currentCamera.y) * pixelsPerUnit + height / 2, ratio);
      context.moveTo(0, screenY);
      context.lineTo(width, screenY);
    }
    context.stroke();

    context.strokeStyle = axisColor;
    context.beginPath();
    const axisX = snapToDevicePixel((0 - currentCamera.x) * pixelsPerUnit + width / 2, ratio);
    const axisY = snapToDevicePixel((0 - currentCamera.y) * pixelsPerUnit + height / 2, ratio);
    if (axisX >= 0 && axisX <= width) {
      context.moveTo(axisX, 0);
      context.lineTo(axisX, height);
    }
    if (axisY >= 0 && axisY <= height) {
      context.moveTo(0, axisY);
      context.lineTo(width, axisY);
    }
    context.stroke();
  }

  function snapToDevicePixel(position: number, ratio: number): number {
    return (Math.round(position * ratio - 0.5) + 0.5) / ratio;
  }
</script>

<!-- Grid canvas (R0.3). -->
<canvas class="grid-layer" bind:this={canvas} aria-hidden="true"></canvas>

<style>
  .grid-layer {
    position: absolute;
    inset: 0;
    display: block;
    width: 100%;
    height: 100%;
    pointer-events: none;
  }
</style>
