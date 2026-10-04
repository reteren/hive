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
// CPU profile of zone dragging and drawing with real mouse input; prints top self-time functions.
const profile = async (label, action) => {
  await send("Profiler.enable"); await send("Profiler.setSamplingInterval", { interval: 200 }); await send("Profiler.start");
  await ev(`(()=>{window.__lt=[];window.__fr=[];if(!window.__po){window.__po=new PerformanceObserver(l=>{for(const e of l.getEntries())window.__lt.push(e.duration)});window.__po.observe({entryTypes:['longtask']})};let on=true;window.__stopfr=()=>on=false;const loop=t=>{window.__fr.push(t);if(on)requestAnimationFrame(loop)};requestAnimationFrame(loop);return 1})()`);
  const t = Date.now(); await action(); const ms = Date.now() - t;
  const { result } = await send("Profiler.stop");
  const stats = await ev(`(()=>{window.__stopfr();const f=window.__fr;const d=f.slice(1).map((t,i)=>t-f[i]).sort((a,b)=>a-b);return {frames:d.length,median:+d[d.length>>1]?.toFixed(1),p95:+d[Math.floor(d.length*0.95)]?.toFixed(1),max:+d.at(-1)?.toFixed(1),longtasks:window.__lt.length,longMax:Math.max(0,...window.__lt)}})()`);
  const nodes = result.profile.nodes; const self = new Map(); const byId = new Map(nodes.map((n) => [n.id, n]));
  const dt = result.profile.timeDeltas; const samples = result.profile.samples; const time = new Map();
  samples.forEach((id, i) => time.set(id, (time.get(id) ?? 0) + (dt[i] ?? 0)));
  for (const [id, us] of time) { const n = byId.get(id); const cf = n.callFrame; const key = `${cf.functionName || "(anon)"} ${cf.url.split("/").pop()}:${cf.lineNumber + 1}`; self.set(key, (self.get(key) ?? 0) + us); }
  const top = [...self].sort((a, b) => b[1] - a[1]).slice(0, 14).map(([k, us]) => `${(us / 1000).toFixed(0).padStart(5)} ms  ${k}`);
  console.log(`== ${label} (${ms} ms wall)`, JSON.stringify(stats)); console.log(top.join("\n"));
};
const dragPath = async (pts, buttons = 1) => { await mouse("mouseMoved", pts[0][0], pts[0][1]); await send("Input.dispatchMouseEvent", { type: "mousePressed", x: pts[0][0], y: pts[0][1], button: "left", buttons: 1, clickCount: 1 }); for (const [x, y] of pts.slice(1)) { await send("Input.dispatchMouseEvent", { type: "mouseMoved", x, y, button: "left", buttons: 1 }); await wait(8); } const l = pts.at(-1); await send("Input.dispatchMouseEvent", { type: "mouseReleased", x: l[0], y: l[1], button: "left", buttons: 0, clickCount: 1 }); await wait(300); };
const wave = (x0, y0, n = 120) => Array.from({ length: n + 1 }, (_, i) => [x0 + i * 6, y0 + Math.sin(i / 8) * 100]);
await send("Page.reload"); await wait(2500);
await send("Emulation.setCPUThrottlingRate", { rate: 6 });
// a board with notes, two zones and a drawing
await ev(`(async()=>{const b=await import('/src/model/board.svelte.ts');const z=await import('/src/model/zones.svelte.ts');const g=await import('/src/model/zone.ts');const c=await import('/src/board/camera.svelte.ts');c.camera.zoom=1;c.camera.x=0;c.camera.y=0;const n=Date.now();for(let i=0;i<40;i++)b.addNote({id:'n'+i,type:'note',name:'Note '+i,text:'Some text in note '+i,x:-60+(i%8)*16,y:-35+Math.floor(i/8)*14,width:12,height:null,createdAt:n+i});z.addZone({id:'z1',name:'Zone A',color:'#6a9fd4',parts:[g.rectContour(-30,-20,40,30)],holes:[],createdAt:n});z.addZone({id:'z2',name:'Zone B',color:'#d46a9f',parts:[g.rectContour(20,5,30,20)],holes:[],createdAt:n});return 1})()`);
await wait(800);
await mouse("mouseMoved", 700, 500); await key("d", "KeyD", 68, 2);
await ev(`(async()=>{(await import('/src/drawing/tools.svelte.ts')).setBrushSettings({size:200,hardness:0,opacity:1})})()`);
await profile("draw big soft stroke", () => dragPath(wave(320, 400)));
await key("e", "KeyE", 69);
await profile("erase stroke", () => dragPath(wave(320, 420)));
await key("d", "KeyD", 68, 2);
// zone drag: grab zone label area / body in select mode — use the zone name text position
const zr = await ev(`(()=>{const t=document.querySelector('[data-zone-id="z1"] .zone-name');if(!t)return null;const r=t.getBoundingClientRect();return [r.x+r.width/2,r.y+r.height/2]})()`);
console.log("zone label at", zr);
await profile("zone drag", () => dragPath(Array.from({ length: 121 }, (_, i) => [zr[0] + i * 3, zr[1] + Math.sin(i / 10) * 60])));
console.log("errors:", errors.slice(0, 3));
process.exit(0);
