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
const tiles = () => ev(`(async()=>{const s=await import('/src/drawing/tileStore.svelte.ts');return s.drawingTileStore.allKeys().length})()`);
// debug 23 p.10: selection — paint clipped inside, border drag moves pixels, Delete, ×, Esc, new selection replaces old.
const drag = async (pts, mods = 0) => { await mouse("mouseMoved", pts[0][0], pts[0][1]); await send("Input.dispatchMouseEvent", { type: "mousePressed", x: pts[0][0], y: pts[0][1], button: "left", buttons: 1, clickCount: 1, modifiers: mods }); for (const [x, y] of pts.slice(1)) { await send("Input.dispatchMouseEvent", { type: "mouseMoved", x, y, button: "left", buttons: 1, modifiers: mods }); await wait(12); } const l = pts.at(-1); await send("Input.dispatchMouseEvent", { type: "mouseReleased", x: l[0], y: l[1], button: "left", buttons: 0, clickCount: 1, modifiers: mods }); await wait(1200); };
const line = (x1, y1, x2, y2, n = 20) => Array.from({ length: n + 1 }, (_, i) => [x1 + (x2 - x1) * i / n, y1 + (y2 - y1) * i / n]);
const sel = () => ev(`(async()=>{const s=await import('/src/drawing/selection.svelte.ts');const a=s.drawingSelection.area;return a?{x:a.x,y:a.y,w:a.width,h:a.height,l:a.level}:null})()`);
const hist = () => ev(`(async()=>{const h=await import('/src/history/history.svelte.ts');return h.history.entries.length+':'+(h.history.entries.at(-1)?.label??'')})()`);
await send("Page.reload"); await wait(2500);
await ev(`(async()=>{const cam=await import('/src/board/camera.svelte.ts');cam.camera.x=0;cam.camera.y=0;cam.camera.zoom=1;const h=await import('/src/history/history.svelte.ts');h.clear();return 1})()`);
await mouse("mouseMoved", 700, 600); await key("d", "KeyD", 68, 2);
await ev(`(async()=>{(await import('/src/drawing/tools.svelte.ts')).setBrushSettings({size:30,opacity:1,hardness:1})})()`);
// a solid band 300..700 x 300..380
for (let y = 300; y <= 380; y += 20) await drag(line(300, y, 700, y));
console.log("0 band alpha", await alphaAt(500, 340), "| hist", await hist());
// 1 select rect 400..600 x 250..450
await key("m", "KeyM", 77);
await drag(line(400, 250, 600, 450, 10));
console.log("1 selection:", JSON.stringify(await sel()), "| tool", await ev(`(async()=>(await import('/src/drawing/tools.svelte.ts')).drawingTools.active)()`), "| × button", await ev(`!!document.querySelector('[data-selection-clear]')`));
await shot("d23-sel-1");
// 2 brush stroke across the selection at y=470? use y=420 (empty area) crossing from 300 to 700
await key("b", "KeyB", 66);
await drag(line(320, 420, 680, 420));
console.log("2 clipped stroke: inside", await alphaAt(500, 420), "outside-left", await alphaAt(340, 420), "outside-right", await alphaAt(660, 420), "| selection kept", !!(await sel()));
await shot("d23-sel-2");
// 3 hover border then drag it right by 150px
await mouse("mouseMoved", 500, 252); await wait(200);
console.log("3 border hover:", await ev(`document.documentElement.dataset.selectionMoveHover`));
const h3 = await hist();
await drag(line(500, 251, 650, 251, 15));
console.log("3 move: old place", await alphaAt(450, 340), "new place", await alphaAt(600, 340), "| sel", JSON.stringify(await sel()), "| hist", h3, "->", await hist());
await shot("d23-sel-3");
// 4 Delete
await key("Delete", "Delete", 46); await wait(800);
console.log("4 Delete: inside", await alphaAt(650, 340), "| hist", await hist());
// 5 × button
const x = await ev(`(()=>{const b=document.querySelector('[data-selection-clear]');if(!b)return null;const r=b.getBoundingClientRect();return [r.x+r.width/2,r.y+r.height/2]})()`);
console.log("5 × at", x);
if (x) await click(x[0], x[1]);
console.log("5 after ×: selection", await sel(), "| pixels unchanged left band", await alphaAt(320, 340));
// 6 new selection replaces old; Esc clears
await key("l", "KeyL", 76);
await drag([[350, 280], [450, 280], [450, 390], [350, 390], [350, 282]]);
const s1 = await sel();
await key("m", "KeyM", 77);
await drag(line(330, 300, 380, 360, 6));
const s2 = await sel();
console.log("6 replace:", JSON.stringify(s1), "->", JSON.stringify(s2));
await key("Escape", "Escape", 27);
console.log("6 Esc:", await sel(), "| still draw mode", await ev(`(async()=>(await import('/src/tools/tool.svelte.ts')).tool.active)()`));
console.log("errors:", errors);
process.exit(0);
