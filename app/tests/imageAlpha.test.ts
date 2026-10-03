import { describe, expect, it } from "vitest";
import imageNodeBodySource from "../src/images/ImageNodeBody.svelte?raw";
import noteNodeSource from "../src/notes/NoteNode.svelte?raw";
import selectionLayerSource from "../src/selection/SelectionLayer.svelte?raw";
import inlineImagesSource from "../src/editor/inlineImages.ts?raw";
import tierlistBodySource from "../src/tierlist/TierlistBody.svelte?raw";
import gifViewSource from "../src/attachments/GifView.svelte?raw";
import gifDomSource from "../src/attachments/gifDom.ts?raw";

describe("image transparency styles", () => {
  it("leaves board image pixels and their frame transparent while retaining missing-file feedback", () => {
    expect(imageNodeBodySource).not.toMatch(/\.image-node-body\s*\{[^}]*background:/su);
    expect(imageNodeBodySource).toContain("background: #242424;");
    expect(noteNodeSource).toMatch(/\.note-card\[data-kind="image"\]\s*\{[^}]*background: transparent;[^}]*border-color: transparent;[^}]*box-shadow: none;/su);
    expect(noteNodeSource).toMatch(/\.note-card\[data-kind="image"\]\s*>\s*\.note-frame\s*\{[^}]*background: transparent;/su);
    expect(selectionLayerSource).toContain('class="selection-outline"');
  });

  it("keeps inline and Tierlist image surfaces clear over their normal backgrounds", () => {
    expect(inlineImagesSource).toMatch(/"\.cm-inline-image-widget\[aria-busy='true'\]":\s*\{\s*minHeight: "24px",\s*\}/u);
    expect(inlineImagesSource).toContain('backgroundColor: "#292929"');
    expect(tierlistBodySource).toContain("background: #292c31;");
    expect(tierlistBodySource).toMatch(/:global\(\.tier-card-image\)\s*\{[^}]*background: transparent;/u);
  });

  it("clears both GIF still-frame canvases before drawing transparent pixels", () => {
    for (const source of [gifViewSource, gifDomSource]) {
      expect(source.indexOf("context.clearRect(")).toBeGreaterThanOrEqual(0);
      expect(source.indexOf("context.clearRect(")).toBeLessThan(source.indexOf("context.drawImage("));
    }
  });
});
