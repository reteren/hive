import type { BrushTip } from "../types";

export const BRUSH_TIPS: readonly { id: BrushTip; label: string }[] = [
  { id: "round", label: "Round" },
  { id: "calligraphy", label: "Calligraphy" },
  { id: "charcoal", label: "Charcoal" },
  { id: "spray", label: "Spray" },
];

/** Keep the WebGL uniform mapping explicit and stable for tests and saved brush settings. */
export function brushTipShaderIndex(tip: BrushTip): number {
  switch (tip) {
    case "calligraphy": return 3;
    case "charcoal": return 4;
    default: return 0;
  }
}
