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
// debug 25 p.7: huge soft brush at far zoom over an existing fine drawing — per-move and commit costs.
await send("Page.reload"); await wait(2500);
const r = await ev(`(async()=>{
const b=await import('/src/drawing/brush.ts');const g=await import('/src/drawing/gpu/glEngine.ts');const h=await import('/src/drawing/history.ts');const ts=await import('/src/drawing/tileStore.svelte.ts');
const gl=g.drawingGpu().gl;const sync=()=>{const px=new Uint8Array(4);gl.readPixels(0,0,1,1,gl.RGBA,gl.UNSIGNED_BYTE,px)};const out={};
// a fine drawing: strokes at zoom 1 covering ~500x300 u
let t=performance.now();
for(let k=0;k<30;k++){const s=b.createStroke({color:'#4080e0',size:60,opacity:1,hardness:0.8},1);for(let i=0;i<=50;i++)s.add({x:-250+i*10,y:-150+k*10});const f=s.finish();h.applyAcrossLevels(f.source,f.rasterX,f.rasterY,f.level,'paint',1);s.dispose()}
sync();out.buildMs=+(performance.now()-t).toFixed(0);out.tilesBefore=ts.drawingTileStore.allKeys().length;
// huge soft brush at zoom 0.05
const st=b.createStroke({color:'#e04040',size:400,opacity:0.8,hardness:0},0.05);
const times=[];for(let i=0;i<=40;i++){const x=-800+i*40,y=Math.sin(i/5)*200;t=performance.now();st.add({x,y});sync();times.push(performance.now()-t)}
times.sort((a,c)=>a-c);out.moveMs={median:+times[20].toFixed(1),p95:+times[38].toFixed(1),max:+times[40].toFixed(1)};
const fin=st.finish();out.strokeLevel=fin.level;out.strokeRaster=[fin.width,fin.height];
t=performance.now();const keys=h.affectedTileKeys(h.rasterRectToWorld(fin.rasterX,fin.rasterY,fin.width,fin.height,fin.level),fin.level,'paint');const before=await ts.drawingTileStore.snapshot(keys);sync();out.snapshotMs=+(performance.now()-t).toFixed(0);out.affected=keys.length;
t=performance.now();h.applyAcrossLevels(fin.source,fin.rasterX,fin.rasterY,fin.level,'paint',0.8);sync();out.applyMs=+(performance.now()-t).toFixed(0);
st.dispose();
out.tilesAfter=ts.drawingTileStore.allKeys().length;out.levels=ts.drawingTileStore.levels();
// render cost at far zoom
const cam=await import('/src/board/camera.svelte.ts');cam.camera.zoom=0.05;await new Promise(r=>setTimeout(r,300));
const rt=[];for(let i=0;i<20;i++){t=performance.now();cam.camera.x=i*3;await Promise.resolve();sync();rt.push(performance.now()-t)}rt.sort((a,c)=>a-c);out.frameMs={median:+rt[10].toFixed(1),max:+rt[19].toFixed(1)};
return out})()`);
console.log(JSON.stringify(r, null, 1));
console.log("errors:", errors);
process.exit(0);
