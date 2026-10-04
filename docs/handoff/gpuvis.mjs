// debug 22 part 2: line/draw sub-tools unfold under their hotbar button; draw panel has no tool grid.
import { writeFileSync } from "node:fs";
const OUT = "C:/Users/reteren/AppData/Local/Temp/claude";
const page = (await fetch(`http://localhost:9334/json/list`).then((r) => r.json())).find((t) => t.type === "page" && t.url.includes("1450"));
const ws = new WebSocket(page.webSocketDebuggerUrl); let id = 0; const pending = new Map(); const errors = [];
ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.method === "Runtime.exceptionThrown") errors.push(m.params.exceptionDetails.exception?.description?.slice(0, 220)); if (pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } };
await new Promise((r) => (ws.onopen = r));
const send = (method, params = {}) => new Promise((r) => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
await send("Runtime.enable");
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const ev = async (expression) => { const r = await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true }); return r.result?.result?.value ?? r.result?.exceptionDetails?.exception?.description; };
const mouse = (type, x, y) => send("Input.dispatchMouseEvent", { type, x, y, button: type === "mouseMoved" ? "none" : "left", buttons: type === "mousePressed" ? 1 : 0, clickCount: type === "mouseMoved" ? 0 : 1 });
const click = async (x, y) => { await mouse("mouseMoved", x, y); await mouse("mousePressed", x, y); await mouse("mouseReleased", x, y); await wait(300); };
const key = async (k, code, vk, modifiers = 0) => { await send("Input.dispatchKeyEvent", { type: "keyDown", key: k, code, windowsVirtualKeyCode: vk, modifiers }); await send("Input.dispatchKeyEvent", { type: "keyUp", key: k, code, windowsVirtualKeyCode: vk, modifiers }); await wait(250); };
const shot = async (n) => writeFileSync(`${OUT}/${n}.png`, Buffer.from((await send("Page.captureScreenshot", { format: "png" })).result.data, "base64"));
const alphaAt = (sx, sy) => ev(`(async()=>{const cam=await import('/src/board/camera.svelte.ts');const cm=await import('/src/board/cameraMath.ts');const h=await import('/src/drawing/history.ts');const t=await import('/src/drawing/types.ts');const b=document.querySelector('.board').getBoundingClientRect();const w=cm.screenToWorld(cam.camera,cam.viewport??(await import('/src/board/camera.svelte.ts')).viewport,{x:${sx}-b.left,y:${sy}-b.top});const px=Math.floor(w.x*t.DRAW_PX_PER_UNIT),py=Math.floor(w.y*t.DRAW_PX_PER_UNIT);const img=h.readRasterRect(px,py,1,1);return img.data[3]})()`);
// GPU drawing engine: visible strokes at several zooms, undo/redo, eraser, fill in a closed shape.
const drag = async (pts) => { await mouse("mouseMoved", pts[0][0], pts[0][1]); await send("Input.dispatchMouseEvent", { type: "mousePressed", x: pts[0][0], y: pts[0][1], button: "left", buttons: 1, clickCount: 1 }); for (const [x, y] of pts.slice(1)) { await send("Input.dispatchMouseEvent", { type: "mouseMoved", x, y, button: "left", buttons: 1 }); await wait(8); } const l = pts.at(-1); await send("Input.dispatchMouseEvent", { type: "mouseReleased", x: l[0], y: l[1], button: "left", buttons: 0, clickCount: 1 }); await wait(400); };
const line = (x1, y1, x2, y2, n = 20) => Array.from({ length: n + 1 }, (_, i) => [x1 + (x2 - x1) * i / n, y1 + (y2 - y1) * i / n]);
const circle = (cx, cy, r, n = 40) => Array.from({ length: n + 1 }, (_, i) => [cx + r * Math.cos(i / n * Math.PI * 2), cy + r * Math.sin(i / n * Math.PI * 2)]);
const set = (o) => ev(`(async()=>{(await import('/src/drawing/tools.svelte.ts')).setBrushSettings(${JSON.stringify(o)})})()`);
const zoomTo = async (z) => { await ev(`(async()=>{const c=await import('/src/board/camera.svelte.ts');c.camera.zoom=${z};c.camera.x=0;c.camera.y=0})()`); await wait(300); };
const hist = () => ev(`(async()=>{const h=await import('/src/history/history.svelte.ts');return h.history.entries.length+':'+(h.history.entries.at(-1)?.label??'')})()`);
// sample the composite through readCompositeRect at the working level of zoom 1 (level 1, 10 px/u)
const alpha = (sx, sy) => ev(`(async()=>{const cam=await import('/src/board/camera.svelte.ts');const cm=await import('/src/board/cameraMath.ts');const h=await import('/src/drawing/history.ts');const b=document.querySelector('.board').getBoundingClientRect();const w=cm.screenToWorld(cam.camera,cam.viewport,{x:${sx}-b.left,y:${sy}-b.top});const img=h.readCompositeRect(Math.floor(w.x*10),Math.floor(w.y*10),1,1,1);return img.data[3]})()`);
await send("Page.reload"); await wait(2500);
await zoomTo(1);
await ev(`(async()=>{const h=await import('/src/history/history.svelte.ts');h.clear()})()`);
await mouse("mouseMoved", 700, 500); await key("d", "KeyD", 68, 2);
await set({ size: 120, opacity: 1, hardness: 0, color: "#4080e0" });
await drag(line(350, 300, 1000, 650, 30));
await set({ size: 20, opacity: 0.6, hardness: 0.9, color: "#e04040" });
await drag(circle(700, 450, 150));
await drag(line(330, 650, 1050, 250, 30));
console.log("1 strokes: hist", await hist(), "| alpha centre of blue", await alpha(675, 475), "| red ring", await alpha(850, 450), "| empty", await alpha(1200, 150));
await shot("gpu-z1");
await zoomTo(0.2); await shot("gpu-z02");
await zoomTo(3); await shot("gpu-z3");
await zoomTo(1);
// undo / redo
await key("z", "KeyZ", 90, 2); await wait(300);
console.log("2 undo last line: alpha on it", await alpha(500, 567), "| hist", await hist());
await key("z", "KeyZ", 90, 10); await wait(300);
console.log("2 redo: alpha", await alpha(500, 567));
// fill inside the red circle
await key("f", "KeyF", 70); await set({ color: "#40c060", opacity: 1 });
const t = Date.now(); await click(700, 380); await wait(500);
console.log("4 fill: ms", Date.now() - t, "| alpha inside", await alpha(700, 380), "| hist", await hist());
// eraser across
await key("e", "KeyE", 69); await set({ size: 60, hardness: 1 });
await drag(line(400, 450, 1000, 450, 20));
console.log("3 erase: alpha on erased", await alpha(675, 450), "| outside", await alpha(675, 330), "| hist", await hist());
await key("b", "KeyB", 66);
await shot("gpu-final");
console.log("errors:", errors);
process.exit(0);
