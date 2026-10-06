import { invoke, isTauri } from "@tauri-apps/api/core";

/**
 * Eyedropper of the HEX palette (debug 28 #3): a full-window overlay with a crosshair; the colour
 * under the pointer is previewed next to it, LMB takes it, Esc / RMB cancels. Desktop samples the
 * real window pixel (same Rust command as the draw-mode eyedropper); a browser build uses the
 * standard EyeDropper API when available.
 */
const state = $state({ active: false });

export function isScreenColorPicking(): boolean {
  return state.active;
}

type EyeDropperCtor = new () => { open: () => Promise<{ sRGBHex: string }> };

let current: { finish: (color: string | null) => void } | null = null;

export function pickScreenColor(): Promise<string | null> {
  current?.finish(null);
  if (!isTauri()) {
    const EyeDropper = (window as unknown as { EyeDropper?: EyeDropperCtor }).EyeDropper;
    if (!EyeDropper) return Promise.resolve(null);
    state.active = true;
    return new EyeDropper().open()
      .then((result) => result.sRGBHex.toLowerCase())
      .catch(() => null)
      .finally(() => { state.active = false; });
  }

  return new Promise((resolve) => {
    state.active = true;
    const overlay = document.createElement("div");
    overlay.dataset.screenColorPicker = "";
    overlay.setAttribute("aria-hidden", "true");
    Object.assign(overlay.style, {
      position: "fixed",
      inset: "0",
      zIndex: "2147483647",
      cursor: "crosshair",
      background: "transparent",
      touchAction: "none",
      userSelect: "none",
    });
    const preview = document.createElement("div");
    Object.assign(preview.style, {
      position: "fixed",
      display: "none",
      alignItems: "center",
      gap: "6px",
      padding: "3px 7px 3px 3px",
      border: "1px solid #484a50",
      borderRadius: "4px",
      background: "#1d1e21",
      color: "#d6d6d6",
      font: "11px/1.2 ui-monospace, Consolas, monospace",
      pointerEvents: "none",
      boxShadow: "0 4px 14px rgb(0 0 0 / 45%)",
    });
    const swatch = document.createElement("span");
    Object.assign(swatch.style, { width: "16px", height: "16px", borderRadius: "3px", border: "1px solid #ffffff55" });
    const label = document.createElement("span");
    preview.append(swatch, label);
    overlay.append(preview);

    let color: string | null = null;
    let revision = 0;
    let inFlight = false;
    let pending: { x: number; y: number; revision: number } | null = null;
    let settledWaiters: (() => void)[] = [];

    const sample = () => {
      if (inFlight || !pending) return;
      const point = pending;
      pending = null;
      inFlight = true;
      void invoke<string | null>("sample_screen_pixel", { clientX: point.x, clientY: point.y })
        .then((hex) => {
          if (hex && point.revision === revision) {
            color = hex.toLowerCase();
            swatch.style.background = color;
            label.textContent = color.toUpperCase();
            preview.style.display = "flex";
          }
        })
        .catch(() => undefined)
        .finally(() => {
          inFlight = false;
          if (pending) sample();
          else {
            const waiters = settledWaiters;
            settledWaiters = [];
            waiters.forEach((resolveWaiter) => resolveWaiter());
          }
        });
    };
    const queue = (x: number, y: number) => {
      pending = { x, y, revision: ++revision };
      const right = x + 150 > window.innerWidth;
      const below = y + 40 > window.innerHeight;
      preview.style.left = `${right ? x - 110 : x + 16}px`;
      preview.style.top = `${below ? y - 30 : y + 16}px`;
      sample();
    };
    const settled = () => new Promise<void>((resolveSettled) => {
      if (!inFlight && !pending) resolveSettled();
      else settledWaiters.push(resolveSettled);
    });

    const stop = (event: Event) => {
      event.preventDefault();
      event.stopPropagation();
    };
    const finish = (result: string | null) => {
      if (!state.active) return;
      state.active = false;
      current = null;
      overlay.remove();
      window.removeEventListener("keydown", onKey, true);
      resolve(result);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopImmediatePropagation();
      finish(null);
    };

    overlay.addEventListener("pointermove", (event) => {
      stop(event);
      queue(event.clientX, event.clientY);
    });
    overlay.addEventListener("pointerdown", (event) => {
      stop(event);
      if (event.button === 2) {
        finish(null);
        return;
      }
      if (event.button !== 0) return;
      queue(event.clientX, event.clientY);
      void settled().then(() => finish(color));
    });
    overlay.addEventListener("pointerup", stop);
    overlay.addEventListener("click", stop);
    overlay.addEventListener("contextmenu", stop);
    overlay.addEventListener("wheel", stop, { passive: false });

    window.addEventListener("keydown", onKey, true);
    document.body.append(overlay);
    current = { finish };
  });
}
