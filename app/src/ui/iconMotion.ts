/**
 * One short gesture per toolbar icon when it is clicked, so each command answers in its own way:
 * the settings gear turns, zoom breathes in or out, home hops, the pencil scribbles.
 *
 * Web Animations on the individual transform properties (rotate / scale / translate), so a CSS hover
 * pose underneath is kept and the gesture starts from what is on screen. Repeated clicks restart it.
 */

type Motion = { frames: Keyframe[]; duration: number; easing: string };

const SPRING = "cubic-bezier(0.34, 1.45, 0.64, 1)";
const OUT = "cubic-bezier(0.16, 1, 0.3, 1)";

function currentDegrees(element: Element): number {
  const value = getComputedStyle(element).rotate;
  const degrees = Number.parseFloat(value);
  return Number.isFinite(degrees) ? degrees : 0;
}

function motionFor(name: string, element: Element): Motion | null {
  switch (name) {
    case "settings": {
      // The gear has 8 teeth: half a turn lands on an identical pose, so nothing jumps at the end.
      const from = currentDegrees(element);
      return { frames: [{ rotate: `${from}deg` }, { rotate: `${from + 180}deg` }], duration: 720, easing: SPRING };
    }
    case "zoom-reset": {
      const from = currentDegrees(element);
      return { frames: [{ rotate: `${from}deg` }, { rotate: `${from - 360}deg` }], duration: 560, easing: OUT };
    }
    case "command":
      // The plus of "Create" turns a quarter — a plus looks the same after 90°.
      return { frames: [{ rotate: "0deg", scale: 0.85 }, { rotate: "90deg", scale: 1 }], duration: 380, easing: SPRING };
    case "zoom-in":
      return { frames: [{ scale: 1 }, { scale: 1.22, offset: 0.4 }, { scale: 1 }], duration: 240, easing: "ease-out" };
    case "zoom-out":
      return { frames: [{ scale: 1 }, { scale: 0.8, offset: 0.4 }, { scale: 1 }], duration: 240, easing: "ease-out" };
    case "home":
      return {
        frames: [
          { translate: "0 0", scale: "1 1" },
          { translate: "0 1px", scale: "1.08 0.9", offset: 0.18 },
          { translate: "0 -3.5px", scale: "0.96 1.06", offset: 0.5 },
          { translate: "0 0", scale: "1 1" },
        ],
        duration: 420,
        easing: OUT,
      };
    case "draw":
      return {
        frames: [{ rotate: "0deg" }, { rotate: "-16deg", offset: 0.3 }, { rotate: "9deg", offset: 0.65 }, { rotate: "0deg" }],
        duration: 420,
        easing: "ease-out",
      };
    case "pointer":
      return { frames: [{ translate: "0 0" }, { translate: "-1.5px -1.5px", offset: 0.35 }, { translate: "0 0" }], duration: 260, easing: OUT };
    case "zone":
    case "grid":
    case "move":
      return { frames: [{ scale: 0.72 }, { scale: 1 }], duration: 320, easing: SPRING };
    case "search":
      return { frames: [{ rotate: "0deg" }, { rotate: "-14deg", offset: 0.35 }, { rotate: "6deg", offset: 0.7 }, { rotate: "0deg" }], duration: 380, easing: "ease-out" };
    case "panel":
      return { frames: [{ translate: "0 0" }, { translate: "2px 0", offset: 0.4 }, { translate: "0 0" }], duration: 260, easing: OUT };
    case "magnet":
      // A snap: the magnet jerks toward its pole and rattles to rest.
      return {
        frames: [
          { translate: "0 0", rotate: "0deg" },
          { translate: "0 -2.5px", rotate: "-10deg", offset: 0.25 },
          { translate: "0 0.5px", rotate: "7deg", offset: 0.55 },
          { translate: "0 0", rotate: "-3deg", offset: 0.8 },
          { translate: "0 0", rotate: "0deg" },
        ],
        duration: 420,
        easing: "ease-out",
      };
    case "line":
      return null;
    default:
      return { frames: [{ scale: 0.8 }, { scale: 1 }], duration: 300, easing: SPRING };
  }
}

function reduceMotion(): boolean {
  return document.documentElement.dataset.reduceMotion === "true";
}

/** Play the click gesture for a toolbar icon (the svg or raster span inside the button). */
export function playIconMotion(icon: Element | null | undefined, name: string): void {
  if (!icon || typeof icon.animate !== "function" || reduceMotion()) return;
  if (name === "line") {
    drawStrokes(icon);
    return;
  }
  const motion = motionFor(name, icon);
  if (!motion) return;
  for (const running of icon.getAnimations()) if (running.id === "icon-motion") running.cancel();
  const animation = icon.animate(motion.frames, { duration: motion.duration, easing: motion.easing });
  animation.id = "icon-motion";
}

/** Line-tool icons redraw their stroke like a pen tracing it. */
function drawStrokes(icon: Element): void {
  for (const path of icon.querySelectorAll<SVGGeometryElement>("path, line, polyline")) {
    if (typeof path.getTotalLength !== "function") continue;
    const length = path.getTotalLength();
    if (!(length > 0)) continue;
    path.animate(
      [
        { strokeDasharray: `${length}`, strokeDashoffset: `${length}` },
        { strokeDasharray: `${length}`, strokeDashoffset: "0" },
      ],
      { duration: 380, easing: OUT },
    );
  }
}

/** A small spring pop for icons without a gesture of their own (sub-tools). */
export function playIconPop(icon: Element | null | undefined): void {
  playIconMotion(icon, "pop");
}
