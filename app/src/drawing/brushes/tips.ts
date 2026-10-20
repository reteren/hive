import type { BrushTip } from "../types";
import { t } from "../../i18n/i18n.svelte";

export const BRUSH_TIPS: readonly { id: BrushTip; label: string }[] = [
  { id: "round", get label() { return t("Round"); } },
  { id: "calligraphy", get label() { return t("Calligraphy"); } },
  { id: "charcoal", get label() { return t("Charcoal"); } },
  { id: "spray", get label() { return t("Spray"); } },
];

/** Keep the WebGL uniform mapping explicit and stable for tests and saved brush settings. */
export function brushTipShaderIndex(tip: BrushTip): number {
  switch (tip) {
    case "calligraphy": return 3;
    case "charcoal": return 4;
    default: return 0;
  }
}
