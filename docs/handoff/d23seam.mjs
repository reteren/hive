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
// debug 23 p.1: soft brush along a coarse curve — left: old polyline capsules, right: smoothed stroke.
await send("Page.reload"); await wait(2500);
const res = await ev(`(async()=>{
const b=await import('/src/drawing/brush.ts');
const pts=[];for(let i=0;i<=9;i++){const a=i/9*Math.PI*1.6;pts.push({x:150+110*Math.cos(a),y:170+110*Math.sin(a)*0.8})}
pts.push({x:60,y:300},{x:200,y:330},{x:120,y:250});
const W=320,H=380,radius=34,hard=0;
const cov=b.createStrokeCoverage(W*H);let len=0;
const P=pts.map(p=>({x:p.x,y:p.y}));
b.accumulateStrokeSegment(cov,W,H,P[0].x,P[0].y,P[0].x,P[0].y,0,0,radius,hard,Math.max(4,radius*1.5));
for(let i=1;i<P.length;i++){const d=Math.hypot(P[i].x-P[i-1].x,P[i].y-P[i-1].y);const n=Math.ceil(d/16);for(let k=1;k<=n;k++){const a={x:P[i-1].x+(P[i].x-P[i-1].x)*(k-1)/n,y:P[i-1].y+(P[i].y-P[i-1].y)*(k-1)/n},c={x:P[i-1].x+(P[i].x-P[i-1].x)*k/n,y:P[i-1].y+(P[i].y-P[i-1].y)*k/n};const s=len;len+=d/n;b.accumulateStrokeSegment(cov,W,H,a.x,a.y,c.x,c.y,s,len,radius,hard,Math.max(4,radius*1.5));}}
const old=document.createElement('canvas');old.width=W;old.height=H;const oc=old.getContext('2d');const im=oc.createImageData(W,H);for(let i=0;i<W*H;i++){im.data[i*4]=232;im.data[i*4+1]=232;im.data[i*4+2]=232;im.data[i*4+3]=cov.value[i]}oc.putImageData(im,0,0);
const types=await import('/src/drawing/types.ts');const ppu=types.levelPxPerUnit(0);
const st=b.createStroke({color:'#e8e8e8',size:34,opacity:1,hardness:0},1,0);
const scale=b.brushWorldWidth(34,1)*ppu/34; // raster diameter per size px
for(const p of pts) st.add({x:p.x/ppu,y:p.y/ppu});
const f=st.finish();
const wrap=document.createElement('div');wrap.id='seamcmp';wrap.style.cssText='position:fixed;inset:0;z-index:99999;background:#151515;display:flex;gap:20px;padding:20px';
old.style.cssText='width:640px;height:760px;image-rendering:pixelated;background:#151515';
const nw=document.createElement('canvas');nw.width=W;nw.height=H;nw.getContext('2d').drawImage(f.source,f.rasterX,f.rasterY);nw.style.cssText=old.style.cssText;
wrap.append(old,nw);document.body.append(wrap);
return {diam:34*scale, src:[f.rasterX,f.rasterY,f.source.width,f.source.height]};
})()`);
console.log(JSON.stringify(res));
await wait(300); await shot("d23-seam");
console.log("errors:", errors);
process.exit(0);
