<script lang="ts">
  import MediaSlider from "../../media-ui/MediaSlider.svelte";
  import ShapePreview from "./ShapePreview.svelte";
  import { setCornerRadius, setPolygonSides, setShapeFillMode, setShapeKind, shapeSettings, shapeUi } from "./state.svelte";

  const kinds = [
    ["line", "Line"],
    ["arrow", "Arrow"],
    ["rectangle", "Rectangle"],
    ["rounded-rectangle", "Rounded rectangle"],
    ["ellipse", "Ellipse"],
    ["triangle", "Triangle"],
    ["star", "5-point star"],
    ["polygon", "Polygon"],
  ] as const;

  function updatePolygonSides(value: number): void {
    setPolygonSides(value + 3);
  }

  function updateCornerRadius(value: number): void {
    setCornerRadius(value);
  }
</script>

<section class="shape-options" data-shape-options data-draw-overlay-control aria-label="Shape options">
  <div class="option">
    <span>Shape</span>
    <div class="choices shape-choices" role="group" aria-label="Shape kind">
      {#each kinds as [value, label]}
        <button
          type="button"
          data-shape-kind={value}
          aria-pressed={shapeSettings.kind === value}
          onclick={() => setShapeKind(value)}
        >{label}</button>
      {/each}
    </div>
  </div>

  <div class="option">
    <span>Style</span>
    <div class="choices" role="group" aria-label="Shape fill style">
      <button type="button" data-shape-fill-mode="outline" aria-pressed={shapeSettings.fillMode === "outline"} onclick={() => setShapeFillMode("outline")}>Outline</button>
      <button type="button" data-shape-fill-mode="fill" aria-pressed={shapeSettings.fillMode === "fill"} onclick={() => setShapeFillMode("fill")}>Fill</button>
      <button type="button" data-shape-fill-mode="outline-fill" aria-pressed={shapeSettings.fillMode === "outline-fill"} onclick={() => setShapeFillMode("outline-fill")}>Outline + fill</button>
    </div>
  </div>

  {#if shapeSettings.kind === "polygon"}
    <label class="option range-option" data-polygon-sides>
      <span>Sides <strong>{shapeSettings.polygonSides}</strong></span>
      <MediaSlider
        value={shapeSettings.polygonSides - 3}
        max={9}
        step={1}
        label="Polygon sides"
        oninput={updatePolygonSides}
        onchange={updatePolygonSides}
      />
    </label>
  {/if}

  {#if shapeSettings.kind === "rounded-rectangle"}
    <label class="option range-option" data-corner-radius>
      <span>Corner radius <strong>{shapeSettings.cornerRadius}px</strong></span>
      <MediaSlider
        value={shapeSettings.cornerRadius}
        max={100}
        step={1}
        label="Rounded rectangle corner radius in screen pixels"
        oninput={updateCornerRadius}
        onchange={updateCornerRadius}
      />
    </label>
  {/if}

  <p class="help">Drag to draw. Shift keeps proportions or snaps lines to 15°. Alt draws from the centre. Enter or click outside to commit; Esc cancels.</p>
  {#if shapeUi.committing}<p class="status" role="status">Committing shape…</p>{/if}
  {#if shapeUi.error}<p class="error" role="alert">{shapeUi.error}</p>{/if}
</section>

<ShapePreview />

<style>
  .shape-options { display: grid; gap: 8px; padding-top: 2px; }
  .option { display: grid; gap: 4px; color: var(--text-dim, #bcbcbc); }
  .option > span { display: flex; justify-content: space-between; align-items: center; }
  .option strong { color: var(--text, #ededed); font-variant-numeric: tabular-nums; }
  .choices { display: flex; flex-wrap: wrap; gap: 4px; }
  .choices button {
    border: 1px solid var(--border, #454545);
    border-radius: 3px;
    padding: 5px 6px;
    color: var(--text, #ededed);
    background: var(--bg-panel-raised);
    font: inherit;
    cursor: pointer;
  }
  .choices button[aria-pressed="true"] { border-color: var(--accent); color: var(--text, #ededed); background: var(--bg-hover); }
  .choices button:focus-visible { outline: 2px solid var(--accent); outline-offset: 1px; }
  .shape-choices button { flex: 1 0 42%; }
  .help, .status, .error { margin: 0; line-height: 1.4; }
  .help { color: var(--text-dim, #bcbcbc); }
  .status { color: var(--text, #ededed); }
  .error { color: #ff9b9b; }
  :global(html[data-reduce-motion="true"]) .shape-options { scroll-behavior: auto; }
</style>
