// R10 delivery 1 smoke with real mouse/keyboard: Ctrl+D, brush strokes (cursor size constant, zoom-dependent world
// width, accumulation rules), undo/redo, eraser, fill closed vs open shape, persistence save, Esc.
import { writeFileSync } from "node:fs";
const OUT = "C:/Users/reteren/AppData/Local/Temp/claude";
const page = (await fetch(`http://localhost:9334/json/list`).then((r) => r.json())).find((t) => t.type === "page");
const ws = new WebSocket(page.webSocketDebuggerUrl); let id = 0; const pending = new Map(); const errors = []; const logs = [];
ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.method === "Runtime.exceptionThrown") errors.push(m.params.exceptionDetails.exception?.description?.slice(0, 220)); if (m.method === "Runtime.consoleAPICalled" && /error|warn/.test(m.params.type)) logs.push(m.params.args.map((a) => a.value ?? a.description).join(" ").slice(0, 160)); if (pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } };
await new Promise((r) => (ws.onopen = r));
const send = (method, params = {}) => new Promise((r) => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
await send("Runtime.enable");
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const ev = async (expression) => { const r = await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true }); return r.result?.result?.value ?? r.result?.exceptionDetails?.exception?.description; };
const mouse = (type, x, y, buttons = 0, modifiers = 0) => send("Input.dispatchMouseEvent", { type, x, y, button: type === "mouseMoved" ? (buttons ? "left" : "none") : "left", buttons, modifiers, clickCount: type === "mouseMoved" ? 0 : 1, pointerType: "mouse" });
const key = async (k, code, vk, modifiers = 0, text) => { await send("Input.dispatchKeyEvent", { type: "keyDown", key: k, code, windowsVirtualKeyCode: vk, modifiers, text }); await send("Input.dispatchKeyEvent", { type: "keyUp", key: k, code, windowsVirtualKeyCode: vk, modifiers }); await wait(150); };
const stroke = async (pts, hold = 0) => { await mouse("mouseMoved", pts[0][0], pts[0][1]); await mouse("mousePressed", pts[0][0], pts[0][1], 1); for (const [x, y] of pts.slice(1)) { await mouse("mouseMoved", x, y, 1); await wait(12); } if (hold) await wait(hold); const l = pts[pts.length - 1]; await mouse("mouseReleased", l[0], l[1], 0); await wait(1200); };
const line = (x1, y1, x2, y2, n = 20) => Array.from({ length: n + 1 }, (_, i) => [x1 + (x2 - x1) * i / n, y1 + (y2 - y1) * i / n]);
const shot = async (n) => writeFileSync(`${OUT}/${n}.png`, Buffer.from((await send("Page.captureScreenshot", { format: "png" })).result.data, "base64"));
// sample alpha of the drawing raster at a screen point (through the tile canvases)
const alphaAt = (sx, sy) => ev(`(async()=>{const cam=await import('/src/board/camera.svelte.ts');const cm=await import('/src/board/cameraMath.ts');const h=await import('/src/drawing/history.ts');const t=await import('/src/drawing/types.ts');const b=document.querySelector('.board').getBoundingClientRect();const w=cm.screenToWorld(cam.camera,cam.viewport??(await import('/src/board/camera.svelte.ts')).viewport,{x:${sx}-b.left,y:${sy}-b.top});const px=Math.floor(w.x*t.DRAW_PX_PER_UNIT),py=Math.floor(w.y*t.DRAW_PX_PER_UNIT);const img=h.readRasterRect(px,py,1,1);return img.data[3]})()`);
const tiles = () => ev(`(async()=>{const s=await import('/src/drawing/tileStore.svelte.ts');return s.drawingTileStore.allKeys().length})()`);

await ev(`(async()=>{const b=await import('/src/model/board.svelte.ts');const cam=await import('/src/board/camera.svelte.ts');const h=await import('/src/history/history.svelte.ts');for(const i of [...b.board.order])b.removeNote(i);h.clear();cam.camera.x=0;cam.camera.y=0;cam.camera.zoom=1;b.addNote({id:'n',type:'note',name:'Note',text:'node text',x:20,y:-25,width:20,height:null,createdAt:Date.now()});return 1})()`);
await wait(500);
await mouse("mouseMoved", 400, 300);
await key("d", "KeyD", 68, 2);
console.log("1 draw mode:", await ev(`(async()=>{const t=await import('/src/tools/tool.svelte.ts');const d=await import('/src/drawing/tools.svelte.ts');return t.tool.active+' / '+d.drawingTools.active+' toolbar '+!!document.querySelector('[data-draw-toolbar]')})()`));
const cursorSize = () => ev(`(()=>{const c=document.querySelector('[data-draw-cursor]');if(!c)return 'no cursor';const r=c.getBoundingClientRect();return Math.round(r.width)+'px'})()`);
console.log("1 cursor zoom1:", await cursorSize());
// stroke 1 horizontal
await stroke(line(300, 300, 700, 300));
console.log("1 after stroke: tiles", await tiles(), "alpha on line", await alphaAt(500, 300), "off line", await alphaAt(500, 330), "| undo entries", await ev(`(async()=>{const h=await import('/src/history/history.svelte.ts');return h.history.entries.length+' last '+h.history.entries.at(-1)?.label})()`));
// within one stroke: go back and forth over same spot -> no accumulation (use 50% opacity)
await ev(`(async()=>{const d=await import('/src/drawing/tools.svelte.ts');d.setBrushSettings({opacity:0.5,hardness:1})})()`);
await stroke([...line(300, 400, 700, 400), ...line(700, 400, 300, 400)]);
const a1 = await alphaAt(500, 400);
await stroke(line(300, 400, 700, 400));
const a2 = await alphaAt(500, 400);
console.log("1 accumulation: back-and-forth in one stroke alpha", a1, "| after a second stroke", a2);
await stroke([[500, 460], [501, 460], [500, 460]], 800);
console.log("1 hold still alpha:", await alphaAt(500, 460));
// zoom out and draw: thicker in world
await ev(`(async()=>{const c=await import('/src/board/camera.svelte.ts');c.camera.zoom=0.5})()`); await wait(300);
await mouse("mouseMoved", 400, 520);
console.log("1 cursor zoom0.5:", await cursorSize());
await ev(`(async()=>{const d=await import('/src/drawing/tools.svelte.ts');d.setBrushSettings({opacity:1})})()`);
await stroke(line(300, 520, 700, 520));
await ev(`(async()=>{const c=await import('/src/board/camera.svelte.ts');c.camera.zoom=1})()`); await wait(400);
await shot("r10-strokes");
// undo / redo
const n0 = await tiles();
await key("z", "KeyZ", 90, 2); await wait(300);
const n1 = await tiles();
await key("z", "KeyZ", 90, 3); await wait(300);
console.log("2 undo tiles", n0, "->", n1, "redo ->", await tiles());
// eraser across stroke 1
await key("e", "KeyE", 69);
console.log("3 tool:", await ev(`(async()=>{const d=await import('/src/drawing/tools.svelte.ts');return d.drawingTools.active})()`));
await stroke(line(500, 270, 500, 330));
console.log("3 eraser: alpha at erased", await alphaAt(500, 300), "kept", await alphaAt(350, 300), "| node intact", await ev(`(async()=>{const b=await import('/src/model/board.svelte.ts');return !!b.board.notes.n})()`));
// fill: closed square then open shape
await key("b", "KeyB", 66);
await ev(`(async()=>{const d=await import('/src/drawing/tools.svelte.ts');d.setBrushSettings({opacity:1,size:6,color:'#40a0ff'})})()`);
await stroke([[800, 380], [950, 380], [950, 520], [800, 520], [800, 380]].flatMap((p, i, a) => i ? line(a[i - 1][0], a[i - 1][1], p[0], p[1], 15).slice(1) : [p]));
await key("f", "KeyF", 70);
await mouse("mouseMoved", 875, 450); await mouse("mousePressed", 875, 450, 1); await mouse("mouseReleased", 875, 450, 0); await wait(800);
console.log("4 fill inside closed: alpha center", await alphaAt(875, 450), "outside", await alphaAt(1000, 450));
await mouse("mouseMoved", 1100, 200); await mouse("mousePressed", 1100, 200, 1); await mouse("mouseReleased", 1100, 200, 0); await wait(800);
console.log("4 fill on empty board: alpha", await alphaAt(1100, 200), "| hint:", await ev(`[...document.querySelectorAll('[role=status],[role=alert],[class*=hint],[class*=toast]')].map(e=>e.textContent.trim()).filter(t=>/fill|closed/i.test(t)).join(' | ')||'none'`));
await shot("r10-fill");
// persistence
await wait(1500);
console.log("5 saved index:", await ev(`(async()=>{const a=await import('/src/drawing/api.ts');const r=await a.drawingLoad();return r.index?r.index.tiles.length+' tiles':'none'})()`));
await key("Escape", "Escape", 27);
console.log("6 Esc ->", await ev(`(async()=>{const t=await import('/src/tools/tool.svelte.ts');return t.tool.active})()`));
console.log("errors:", errors.length ? errors.join(" || ") : "none"); console.log("console:", logs.slice(0, 6).join(" || ") || "none");
ws.close();
