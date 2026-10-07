<script lang="ts">
  import { onMount } from "svelte";
  import { cachedClientRect } from "../../board/boardRect";
  import { camera, viewport } from "../../board/camera.svelte";
  import { PX_PER_UNIT } from "../../board/cameraMath";
  import { drawingTools } from "../tools.svelte";
  import { shapeSettings, shapeUi } from "./state.svelte";
  import { isLineShape, lineEndpoints, localLineEnds, shapeCenter, shapeSize, traceClosedShape, type ShapeDraft } from "./shapeGeometry";

  let scheduleRender: (() => void) | null = null;

  $effect(() => {
    const draft = shapeUi.draft;
    void draft?.kind;
    void draft?.left;
    void draft?.top;
    void draft?.right;
    void draft?.bottom;
    void draft?.rotation;
    void draft?.flipX;
    void draft?.flipY;
    void shapeSettings.fillMode;
    void shapeSettings.polygonSides;
    void shapeSettings.cornerRadius;
    void drawingTools.brush.color;
    void drawingTools.brush.size;
    void drawingTools.brush.opacity;
    void drawingTools.brush.hardness;
    void camera.x;
    void camera.y;
    void camera.zoom;
    void viewport.width;
    void viewport.height;
    scheduleRender?.();
  });

  onMount(() => {
    const canvas = document.createElement("canvas");
    canvas.dataset.shapePreview = "true";
    canvas.setAttribute("aria-hidden", "true");
    canvas.style.cssText = "position:fixed;inset:0;width:100vw;height:100vh;pointer-events:none;z-index:23";
    document.body.append(canvas);
    let frame = 0;

    const render = () => {
      frame = 0;
      const ratio = Math.max(1, window.devicePixelRatio || 1);
      const width = window.innerWidth;
      const height = window.innerHeight;
      const backingWidth = Math.max(1, Math.round(width * ratio));
      const backingHeight = Math.max(1, Math.round(height * ratio));
      if (canvas.width !== backingWidth || canvas.height !== backingHeight) {
        canvas.width = backingWidth;
        canvas.height = backingHeight;
      }
      const ctx = canvas.getContext("2d");
      const board = document.querySelector<HTMLElement>(".board");
      const draft = shapeUi.draft;
      if (!ctx || !board || !draft) {
        ctx?.clearRect(0, 0, width * ratio, height * ratio);
        return;
      }
      ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
      ctx.clearRect(0, 0, width, height);
      const rect = cachedClientRect(board);
      const screenScale = camera.zoom * PX_PER_UNIT;
      const clientPoint = (x: number, y: number) => ({
        x: rect.left + viewport.width / 2 + (x - camera.x) * screenScale,
        y: rect.top + viewport.height / 2 + (y - camera.y) * screenScale,
      });
      ctx.save();
      ctx.beginPath();
      ctx.rect(rect.left, rect.top, rect.width, rect.height);
      ctx.clip();
      drawShape(ctx, draft, clientPoint, screenScale);
      drawEditingFrame(ctx, draft, clientPoint, screenScale);
      ctx.restore();
    };
    scheduleRender = () => {
      if (frame === 0) frame = requestAnimationFrame(render);
    };
    const onResize = () => scheduleRender?.();
    window.addEventListener("resize", onResize);
    scheduleRender();
    return () => {
      if (frame !== 0) cancelAnimationFrame(frame);
      scheduleRender = null;
      window.removeEventListener("resize", onResize);
      canvas.remove();
    };
  });

  function drawShape(
    ctx: CanvasRenderingContext2D,
    draft: ShapeDraft,
    clientPoint: (x: number, y: number) => { x: number; y: number },
    screenScale: number,
  ): void {
    const centerWorld = shapeCenter(draft);
    const center = clientPoint(centerWorld.x, centerWorld.y);
    const size = shapeSize(draft);
    const width = size.width * screenScale;
    const height = size.height * screenScale;
    const brush = drawingTools.brush;
    const blur = brush.size * (1 - brush.hardness) * 0.35;
    const lineLike = draft.kind === "line" || draft.kind === "arrow";
    ctx.save();
    ctx.translate(center.x, center.y);
    ctx.rotate(draft.rotation);
    ctx.scale(draft.flipX ? -1 : 1, draft.flipY ? -1 : 1);
    ctx.globalAlpha = Math.min(1, Math.max(0, brush.opacity));
    ctx.strokeStyle = brush.color;
    ctx.fillStyle = brush.color;
    ctx.lineWidth = brush.size;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";

    if (lineLike) {
      const { x1, y1, x2, y2 } = localLineEnds(width, height);
      ctx.beginPath();
      ctx.moveTo(x1, y1);
      ctx.lineTo(x2, y2);
      ctx.filter = blur >= 0.5 ? `blur(${blur}px)` : "none";
      ctx.stroke();
      ctx.filter = "none";
      if (draft.kind === "arrow") {
        const dx = x2 - x1;
        const dy = y2 - y1;
        const length = Math.hypot(dx, dy);
        const headLength = Math.min(length * 0.35, Math.max(brush.size * 4, 12));
        const angle = Math.atan2(dy, dx);
        ctx.beginPath();
        ctx.moveTo(x2, y2);
        ctx.lineTo(x2 - headLength * Math.cos(angle - Math.PI / 6), y2 - headLength * Math.sin(angle - Math.PI / 6));
        ctx.moveTo(x2, y2);
        ctx.lineTo(x2 - headLength * Math.cos(angle + Math.PI / 6), y2 - headLength * Math.sin(angle + Math.PI / 6));
        ctx.filter = blur >= 0.5 ? `blur(${blur}px)` : "none";
        ctx.stroke();
        ctx.filter = "none";
      }
    } else {
      const closed = traceClosedShape(ctx, draft.kind, width, height, shapeSettings.polygonSides, shapeSettings.cornerRadius);
      if (closed && shapeSettings.fillMode !== "outline") ctx.fill();
      if (closed && shapeSettings.fillMode !== "fill") {
        ctx.filter = blur >= 0.5 ? `blur(${blur}px)` : "none";
        ctx.stroke();
        ctx.filter = "none";
      }
    }
    ctx.restore();
  }

  function drawEditingFrame(
    ctx: CanvasRenderingContext2D,
    draft: ShapeDraft,
    clientPoint: (x: number, y: number) => { x: number; y: number },
    screenScale: number,
  ): void {
    if (isLineShape(draft.kind)) {
      // Lines and arrows have no frame: a round handle on each end.
      const { start, end } = lineEndpoints(draft);
      for (const point of [start, end]) {
        const at = clientPoint(point.x, point.y);
        ctx.beginPath();
        ctx.arc(at.x, at.y, 5, 0, Math.PI * 2);
        ctx.fillStyle = "#fff";
        ctx.fill();
        ctx.strokeStyle = "#262626";
        ctx.lineWidth = 1;
        ctx.stroke();
      }
      return;
    }
    const centerWorld = shapeCenter(draft);
    const center = clientPoint(centerWorld.x, centerWorld.y);
    const size = shapeSize(draft);
    const width = Math.max(size.width * screenScale, 12);
    const height = Math.max(size.height * screenScale, 12);
    ctx.save();
    ctx.translate(center.x, center.y);
    ctx.rotate(draft.rotation);
    ctx.setLineDash([5, 4]);
    ctx.lineWidth = 1;
    ctx.strokeStyle = "rgba(255,255,255,.95)";
    ctx.strokeRect(-width / 2, -height / 2, width, height);
    ctx.setLineDash([]);
    const halfW = width / 2;
    const halfH = height / 2;
    const handles = [
      [-halfW, -halfH], [0, -halfH], [halfW, -halfH], [halfW, 0],
      [halfW, halfH], [0, halfH], [-halfW, halfH], [-halfW, 0],
    ] as const;
    for (const [x, y] of handles) {
      ctx.beginPath();
      ctx.rect(x - 4, y - 4, 8, 8);
      ctx.fillStyle = "#fff";
      ctx.fill();
      ctx.strokeStyle = "#262626";
      ctx.lineWidth = 1;
      ctx.stroke();
    }
    ctx.beginPath();
    ctx.moveTo(0, -halfH);
    ctx.lineTo(0, -halfH - 20);
    ctx.strokeStyle = "#fff";
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(0, -halfH - 20, 5, 0, Math.PI * 2);
    ctx.fillStyle = "#fff";
    ctx.fill();
    ctx.strokeStyle = "#262626";
    ctx.stroke();
    ctx.restore();
  }
</script>
