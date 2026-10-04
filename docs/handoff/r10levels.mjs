// R10 resolution-pyramid smoke: brush/eraser/fill/selection far zoomed out, and mixing levels
// (detail drawn at zoom 1, then painted over / erased / moved from zoom 0.1). Reads the VISIBLE
// composite of all levels. Needs vite :1450 (fresh server: HMR ?t= imports give a second module copy)
// and headless Edge CDP :9334.
import { writeFileSync } from "node:fs";
const OUT = "C:/Users/reteren/AppData/Local/Temp/claude";
const page = (await fetch(`http://localhost:9334/json/list`).then((r) => r.json())).find((t) => t.type === "page");
const ws = new WebSocket(page.webSocketDebuggerUrl); let id = 0; const pending = new Map(); const errors = [];
ws.onmessage = (e) => {
  const m = JSON.parse(e.data);
  if (m.method === "Runtime.exceptionThrown") errors.push(m.params.exceptionDetails.exception?.description?.slice(0, 200));
  if (m.method === "Runtime.consoleAPICalled" && m.params.type === "error") errors.push(m.params.args.map((a) => a.value ?? a.description).join(" ").slice(0, 200));
  if (pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
};
await new Promise((r) => (ws.onopen = r));
const send = (method, params = {}) => new Promise((r) => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
await send("Runtime.enable");
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const ev = async (expression) => { const r = await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true }); return r.result?.result?.value ?? r.result?.exceptionDetails?.exception?.description; };
const mouse = (type, x, y, buttons = 0) => send("Input.dispatchMouseEvent", { type, x, y, button: type === "mouseMoved" ? (buttons ? "left" : "none") : "left", buttons, clickCount: type === "mouseMoved" ? 0 : 1 });
const key = async (k, code, vk, modifiers = 0) => { await send("Input.dispatchKeyEvent", { type: "keyDown", key: k, code, windowsVirtualKeyCode: vk, modifiers }); await send("Input.dispatchKeyEvent", { type: "keyUp", key: k, code, windowsVirtualKeyCode: vk, modifiers }); await wait(150); };
const line = (x1, y1, x2, y2, n = 20) => Array.from({ length: n + 1 }, (_, i) => [x1 + (x2 - x1) * i / n, y1 + (y2 - y1) * i / n]);
const historyLength = () => ev(`(async()=>(await import("/src/history/history.svelte.ts")).history.cursor)()`);
let worstMove = 0;
const drag = async (pts) => {
  await mouse("mouseMoved", pts[0][0], pts[0][1]); await mouse("mousePressed", pts[0][0], pts[0][1], 1);
  for (const [x, y] of pts.slice(1)) { const t = Date.now(); await mouse("mouseMoved", x, y, 1); worstMove = Math.max(worstMove, Date.now() - t); }
  const l = pts.at(-1); await mouse("mouseReleased", l[0], l[1], 0); await wait(1200);
};
const click = async (x, y) => { await mouse("mouseMoved", x, y); await mouse("mousePressed", x, y, 1); await mouse("mouseReleased", x, y, 0); await wait(1500); };
/** Visible RGBA (all levels) under a screen point. */
const rgba = (sx, sy) => ev(`(async()=>{const cam=await import('/src/board/camera.svelte.ts');const cm=await import('/src/board/cameraMath.ts');const h=await import('/src/drawing/history.ts');const b=document.querySelector('.board').getBoundingClientRect();const w=cm.screenToWorld(cam.camera,cam.viewport,{x:${sx}-b.left,y:${sy}-b.top});const d=h.readCompositeRect(Math.floor(w.x*20),Math.floor(w.y*20),1,1,0).data;return [...d].join(',')})()`);
const alpha = async (sx, sy) => Number((await rgba(sx, sy)).split(",")[3]);
const zoom = (z) => ev(`(async()=>{const c=await import('/src/board/camera.svelte.ts');c.camera.x=0;c.camera.y=0;c.camera.zoom=${z}})()`).then(() => wait(300));
const tool = (t) => ev(`(async()=>{(await import('/src/drawing/tools.svelte.ts')).setActiveDrawTool('${t}')})()`);
const brush = (o) => ev(`(async()=>{(await import('/src/drawing/tools.svelte.ts')).setBrushSettings(${JSON.stringify(o)})})()`);
const levels = () => ev(`(async()=>(await import('/src/drawing/tileStore.svelte.ts')).drawingTileStore.levels().join(','))()`);
const shot = async (name) => { const s = await send("Page.captureScreenshot", { format: "png" }); writeFileSync(`${OUT}/${name}.png`, Buffer.from(s.result.data, "base64")); };

await ev(`(async()=>{const b=await import('/src/model/board.svelte.ts');const h=await import('/src/history/history.svelte.ts');for(const i of [...b.board.order])b.removeNote(i);h.clear();const s=await import('/src/drawing/tileStore.svelte.ts');await s.drawingTileStore.replaceFromSnapshot(new Map());const t=await import('/src/tools/tool.svelte.ts');if(t.tool.active!=='draw'){window.dispatchEvent(new KeyboardEvent('keydown',{key:'d',code:'KeyD',ctrlKey:true,bubbles:true}));await new Promise(r=>setTimeout(r,200))}})()`);

// 1. far zoomed out: brush is fast and lands
await zoom(0.05); await tool("brush"); await brush({ size: 20, opacity: 1, hardness: 0.85, color: "#e8e8e8" });
const h0 = await historyLength();
await drag(line(350, 200, 1150, 260, 40));
for (let i = 0; i < 20 && (await historyLength()) === h0; i++) await wait(100);
console.log("1 zoom 0.05 brush: on line", await alpha(750, 230), "off", await alpha(750, 330), "| history +", (await historyLength()) - h0, "| worst move", worstMove, "ms | levels", await levels());

// 2. far zoomed out: big closed square, fill inside
await brush({ size: 8, color: "#40a0ff" });
await drag([[400, 330], [800, 330], [800, 600], [400, 600], [400, 330]].flatMap((p, i, a) => i ? line(a[i - 1][0], a[i - 1][1], p[0], p[1], 20).slice(1) : [p]));
await tool("fill"); await brush({ color: "#ff8000" });
await click(600, 465);
console.log("2 zoom 0.05 fill: centre", await rgba(600, 465), "| outside", await alpha(900, 465));

// 3. far zoomed out: eraser through the line
await tool("eraser"); await brush({ size: 40 });
await drag(line(750, 150, 750, 300, 10));
console.log("3 zoom 0.05 eraser: erased", await alpha(750, 230), "| kept", await alpha(500, 220));
await shot("r10-levels-far");

// 4. mixing: red detail at zoom 1, painted over in blue from zoom 0.1, then erased from zoom 0.1
await ev(`(async()=>{const s=await import('/src/drawing/tileStore.svelte.ts');await s.drawingTileStore.replaceFromSnapshot(new Map())})()`);
await zoom(1); await tool("brush"); await brush({ size: 10, color: "#ff0000", opacity: 1 });
await drag(line(400, 400, 900, 400, 25));
const redAt1 = await rgba(650, 400);
await zoom(0.1);
// the red line is now 10x shorter around the centre; paint blue across its middle
const cx = await ev(`(async()=>{const cam=await import('/src/board/camera.svelte.ts');const b=document.querySelector('.board').getBoundingClientRect();return JSON.stringify({left:b.left,top:b.top,w:cam.viewport.width,h:cam.viewport.height})})()`);
const box = JSON.parse(cx);
// screen point of the red line's midpoint after zooming to 0.1 around world (0,0)
const at1 = { x: 650, y: 400 };
const worldMid = { x: (at1.x - box.left - box.w / 2) / 10, y: (at1.y - box.top - box.h / 2) / 10 };
const mid = { x: box.left + box.w / 2 + worldMid.x * 1, y: box.top + box.h / 2 + worldMid.y * 1 };
console.log("4 red at zoom 1:", redAt1, "| seen from zoom 0.1:", await rgba(mid.x, mid.y), "| levels", await levels());
await brush({ size: 6, color: "#0000ff" });
await drag(line(mid.x, mid.y - 30, mid.x, mid.y + 30, 10));
console.log("4 blue over red from zoom 0.1:", await rgba(mid.x, mid.y), "| red elsewhere", await rgba(mid.x - 15, mid.y), "| levels", await levels());
await zoom(1);
console.log("4 back at zoom 1: crossing", await rgba(650, 400), "| red away from crossing", await rgba(450, 400));
await zoom(0.1);
await tool("eraser"); await brush({ size: 10 });
await drag(line(mid.x - 12, mid.y - 20, mid.x - 12, mid.y + 20, 8));
await zoom(1);
const erasedX = 650 - 120;
console.log("4 erased from zoom 0.1, checked at zoom 1:", await alpha(erasedX, 400), "| red kept", await alpha(420, 400));
await shot("r10-levels-mix");

// 5. selection from zoom 0.1 on zoom-1 detail: move a piece, undo
await zoom(0.1); await tool("select-rect");
await drag(line(mid.x + 4, mid.y - 12, mid.x + 30, mid.y + 12, 8));
const selected = await ev(`(async()=>{const s=await import('/src/drawing/selection.svelte.ts');const a=s.drawingSelection.area;return a?a.level+':'+a.width+'x'+a.height:'none'})()`);
await drag(line(mid.x + 15, mid.y, mid.x + 15, mid.y + 60, 10));
await key("Escape", "Escape", 27); await wait(800);
console.log("5 select at zoom 0.1 (", selected, "): old place", await alpha(mid.x + 15, mid.y), "| new place", await alpha(mid.x + 15, mid.y + 60));
await key("z", "KeyZ", 90, 2); await wait(1000);
console.log("5 undo move: old place", await alpha(mid.x + 15, mid.y), "| new place", await alpha(mid.x + 15, mid.y + 60));

// 6. delete a selected piece from zoom 0.1
await drag(line(mid.x + 4, mid.y - 12, mid.x + 30, mid.y + 12, 8));
await key("Delete", "Delete", 46); await wait(1000);
console.log("6 delete at zoom 0.1: deleted", await alpha(mid.x + 15, mid.y), "| left part", await alpha(mid.x - 20, mid.y));
await shot("r10-levels-select");
console.log("errors:", errors.length ? errors.slice(0, 5).join(" || ") : "none");
ws.close();
