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
// In-page timings of the GPU drawing engine (gl.finish() included so GPU work is counted).
await send("Page.reload"); await wait(2500);
const r = await ev(`(async()=>{
const b=await import('/src/drawing/brush.ts');const g=await import('/src/drawing/gpu/glEngine.ts');const h=await import('/src/drawing/history.ts');const ts=await import('/src/drawing/tileStore.svelte.ts');const f=await import('/src/drawing/fill.ts');
const gpu=g.drawingGpu();const gl=gpu.gl;const out={};
// 1 big soft stroke: 60 pointer events across 1400 px at zoom 1 (level 0, 20 px/u)
const st=b.createStroke({color:'#4080e0',size:400,opacity:1,hardness:0},1);
const times=[];for(let i=0;i<=60;i++){const x=(-700+i*1400/60)/10,y=(Math.sin(i/6)*120)/10;const t=performance.now();st.add({x,y});gl.finish();times.push(performance.now()-t)}
times.sort((a,c)=>a-c);out.bigSoftAddMs={median:+times[30].toFixed(2),p95:+times[57].toFixed(2),max:+times[60].toFixed(2)};
let t=performance.now();const fin=st.finish();const keys=h.affectedTileKeys(h.rasterRectToWorld(fin.rasterX,fin.rasterY,fin.width,fin.height,fin.level),fin.level,'paint');const before=await ts.drawingTileStore.snapshot(keys);h.applyAcrossLevels(fin.source,fin.rasterX,fin.rasterY,fin.level,'paint',1);const after=await ts.drawingTileStore.snapshot(keys);gl.finish();out.commitMs=+(performance.now()-t).toFixed(1);out.commitTiles=keys.length;st.dispose();
// 2 many strokes at zoom 0.1 to build a big drawing, then fill an enclosed region
for(let k=0;k<40;k++){const s2=b.createStroke({color:'#e04040',size:30,opacity:1,hardness:0.8},0.1);for(let i=0;i<=30;i++)s2.add({x:-600+i*40,y:-400+k*20+Math.sin(i)*5});const f2=s2.finish();h.applyAcrossLevels(f2.source,f2.rasterX,f2.rasterY,f2.level,'paint',1);s2.dispose()}
const ring=b.createStroke({color:'#40c060',size:20,opacity:1,hardness:1},0.1);for(let i=0;i<=80;i++){const a=i/80*Math.PI*2;ring.add({x:300+250*Math.cos(a),y:-1200+250*Math.sin(a)})}const fr=ring.finish();h.applyAcrossLevels(fr.source,fr.rasterX,fr.rasterY,fr.level,'paint',1);ring.dispose();
gl.finish();out.tiles=ts.drawingTileStore.allKeys().length;out.levels=ts.drawingTileStore.levels();
const lvl=(await import('/src/drawing/types.ts')).currentDrawLevel(0.1);
t=performance.now();const p=f.fillRasterPoint({x:300,y:-1200},lvl);const win=f.fillWindowAt(p.x,p.y);const img=h.readCompositeRect(win.x,win.y,win.width,win.height,lvl);out.fillReadMs=+(performance.now()-t).toFixed(1);
t=performance.now();const res=f.prepareFloodFill(img.data,img.width,img.height,p.x-win.x,p.y-win.y,{color:'#ffffff',opacity:1,rasterX:win.x,rasterY:win.y,level:lvl});out.floodMs=+(performance.now()-t).toFixed(1);out.floodStatus=res.status;
if(res.image){t=performance.now();const ks=h.affectedTileKeys(h.rasterRectToWorld(res.image.rasterX,res.image.rasterY,res.image.width,res.image.height,lvl),lvl,'paint');await ts.drawingTileStore.snapshot(ks);h.applyAcrossLevels(f.toImageData(res.image),res.image.rasterX,res.image.rasterY,lvl,'paint',1);gl.finish();out.fillApplyMs=+(performance.now()-t).toFixed(1)}
// 3 frame render cost at zoom 0.1 with everything visible
const cam=await import('/src/board/camera.svelte.ts');cam.camera.zoom=0.05;cam.camera.x=0;cam.camera.y=-600;await new Promise(r=>setTimeout(r,200));
const rt=[];for(let i=0;i<30;i++){const s=performance.now();cam.camera.x=Math.sin(i)*200;await Promise.resolve();await new Promise(r=>queueMicrotask(r));gl.finish();rt.push(performance.now()-s)}rt.sort((a,c)=>a-c);out.panFrameMs={median:+rt[15].toFixed(2),max:+rt[29].toFixed(2)};
return out})()`);
console.log(JSON.stringify(r, null, 1));
await shot("gpu-bench");
console.log("errors:", errors);
process.exit(0);
