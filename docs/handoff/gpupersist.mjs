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
// Save/load round trip: exportPngs → replaceFromPngs keeps pixels; empty tiles are dropped on save.
await send("Page.reload"); await wait(2500);
const r = await ev(`(async()=>{
const h=await import('/src/drawing/history.ts');const ts=await import('/src/drawing/tileStore.svelte.ts');
const img=new ImageData(32,32);for(let i=0;i<img.data.length;i+=4){img.data[i]=10;img.data[i+1]=120;img.data[i+2]=240;img.data[i+3]=128}
h.writeRasterRect(img,600,5,0);
h.writeRasterRect(new ImageData(8,8),5,5,0); // creates an empty tile 0:0
const keys=ts.drawingTileStore.allKeys();
const t=performance.now();const pngs=await ts.drawingTileStore.exportPngs(keys);const exportMs=performance.now()-t;
const blobs=new Map([...pngs].filter(([,v])=>v).map(([k,v])=>[k,new Blob([v],{type:'image/png'})]));
await ts.drawingTileStore.replaceFromPngs(new Map());
const empty=ts.drawingTileStore.allKeys().length;
await ts.drawingTileStore.replaceFromPngs(blobs);
const px=h.readRasterRect(610,10,1,1,0).data;
return {keysBefore:keys,saved:[...pngs].map(([k,v])=>k+':'+(v?v.length:'null')),exportMs:+exportMs.toFixed(1),emptyAfterClear:empty,keysAfter:ts.drawingTileStore.allKeys(),pixel:[...px]}})()`);
console.log(JSON.stringify(r));
console.log("errors:", errors);
process.exit(0);
