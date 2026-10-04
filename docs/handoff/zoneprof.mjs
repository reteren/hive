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
// Break down zone-drag cost (script / style / layout / task) with and without a drawing, CPU 6x slower.
const metrics = async () => Object.fromEntries((await send("Performance.getMetrics")).result.metrics.map((m) => [m.name, m.value]));
const dragPath = async (pts) => { await mouse("mouseMoved", pts[0][0], pts[0][1]); await send("Input.dispatchMouseEvent", { type: "mousePressed", x: pts[0][0], y: pts[0][1], button: "left", buttons: 1, clickCount: 1 }); for (const [x, y] of pts.slice(1)) { await send("Input.dispatchMouseEvent", { type: "mouseMoved", x, y, button: "left", buttons: 1 }); await wait(8); } const l = pts.at(-1); await send("Input.dispatchMouseEvent", { type: "mouseReleased", x: l[0], y: l[1], button: "left", buttons: 0, clickCount: 1 }); await wait(300); };
const measure = async (label, action) => { const a = await metrics(); await action(); const b = await metrics(); const d = (k) => ((b[k] - a[k]) * 1000).toFixed(0); console.log(label.padEnd(26), "task", d("TaskDuration"), "script", d("ScriptDuration"), "style", d("RecalcStyleDuration"), "layout", d("LayoutDuration"), "layouts", b.LayoutCount - a.LayoutCount, "styles", b.RecalcStyleCount - a.RecalcStyleCount); };
await send("Performance.enable");
for (const withDrawing of [false]) {
  await send("Page.reload"); await wait(2500);
  await send("Emulation.setCPUThrottlingRate", { rate: 6 });
  await ev(`(async()=>{const b=await import('/src/model/board.svelte.ts');const z=await import('/src/model/zones.svelte.ts');const g=await import('/src/model/zone.ts');const c=await import('/src/board/camera.svelte.ts');c.camera.zoom=1;c.camera.x=0;c.camera.y=0;const n=Date.now();for(let i=0;i<200;i++)b.addNote({id:'n'+i,type:'note',name:'Note '+i,text:'Some text in note '+i,x:-120+(i%20)*13,y:-60+Math.floor(i/20)*12,width:12,height:null,createdAt:n+i});z.addZone({id:'z1',name:'Zone A',color:'#6a9fd4',parts:[g.rectContour(-40,-90,60,70)],holes:[],createdAt:n});z.addZone({id:'z2',name:'Zone B',color:'#d46a9f',parts:[g.rectContour(30,-30,50,50)],holes:[],createdAt:n+1});return 1})()`);
  if (withDrawing) {
    await ev(`(async()=>{const b=await import('/src/drawing/brush.ts');const h=await import('/src/drawing/history.ts');for(let k=0;k<12;k++){const s=b.createStroke({color:'#e04040',size:120,opacity:1,hardness:0},1);for(let i=0;i<=40;i++)s.add({x:-60+i*3,y:-40+k*7+Math.sin(i/3)*3});const f=s.finish();h.applyAcrossLevels(f.source,f.rasterX,f.rasterY,f.level,'paint',1);s.dispose()}return 1})()`);
  }
  await wait(1000);
  const nr = await ev(`(()=>{const r=document.querySelector('[data-note-id="n45"] .note-header, [data-note-id="n45"]').getBoundingClientRect();return [r.x+10,r.y+6]})()`);
  await send("Profiler.enable"); await send("Profiler.setSamplingInterval", { interval: 200 }); await send("Profiler.start");
  await measure("note drag", () => dragPath(Array.from({ length: 81 }, (_, i) => [nr[0] + i * 3, nr[1] + Math.sin(i / 10) * 60])));
  { const { result } = await send("Profiler.stop"); const nodes = result.profile.nodes; const byId = new Map(nodes.map((n) => [n.id, n])); const parent = new Map(); for (const n of nodes) for (const c of n.children ?? []) parent.set(c, n.id);
    const total = new Map(); const dt = result.profile.timeDeltas;
    result.profile.samples.forEach((id, i) => { const seen = new Set(); let cur = id; while (cur !== undefined) { const n = byId.get(cur); const cf = n.callFrame; const key = `${cf.functionName || "(anon)"} ${cf.url.split("/").pop().split("?")[0]}:${cf.lineNumber + 1}`; if (!seen.has(key)) { seen.add(key); total.set(key, (total.get(key) ?? 0) + (dt[i] ?? 0)); } cur = parent.get(cur); } });
    console.log([...total].filter(([k]) => !/runtime-|index-client|legacy-client|\(root\)|\(program\)|\(idle\)/.test(k)).sort((a, b) => b[1] - a[1]).slice(0, 18).map(([k, us]) => `${(us / 1000).toFixed(0).padStart(6)} ms incl  ${k}`).join(String.fromCharCode(10))); }
  const zr = await ev(`(async()=>{const cam=await import('/src/board/camera.svelte.ts');const cm=await import('/src/board/cameraMath.ts');const b=document.querySelector('.board').getBoundingClientRect();const p=cm.worldToScreen(cam.camera,cam.viewport,{x:-30,y:-80});return [p.x+b.left,p.y+b.top]})()`);
  await ev(`(async()=>{const s=await import('/src/selection/selection.svelte.ts');s.selection.ids=[];s.selection.primaryId=null;s.selection.zoneIds=['z1'];return 1})()`);
  await mouse("mouseMoved", zr[0], zr[1]); await wait(100);
  await ev(`(async()=>{const m=await import('/src/commands/objectMenu.ts');m.runZoneMenuAction('z1','grab',{x:-30,y:-80});return 1})()`); await wait(200);
  console.log("zone members:", await ev(`(async()=>(await import('/src/zones/membership.svelte.ts')).zoneMembers('z1').length)()`));
  await measure(`zone grab-move`, async () => { for (let i = 0; i <= 80; i += 1) { await mouse("mouseMoved", zr[0] + i * 3, zr[1] + Math.sin(i / 10) * 60); await wait(8); } await click(zr[0] + 240, zr[1]); });
  await measure(`pan camera ${withDrawing ? "+drawing" : ""}`, () => ev(`(async()=>{const c=await import('/src/board/camera.svelte.ts');for(let i=0;i<60;i++){c.camera.x=Math.sin(i/5)*30;await new Promise(r=>requestAnimationFrame(r))}return 1})()`));
}
console.log("errors:", errors.slice(0, 3));
process.exit(0);
