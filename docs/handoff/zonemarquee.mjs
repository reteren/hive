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
await send("Page.reload"); await wait(3000);
await ev(`(async()=>{const b=await import('/src/model/board.svelte.ts');const z=await import('/src/model/zones.svelte.ts');const zm=await import('/src/model/zone.ts');const c=await import("/src/board/camera.svelte.ts");c.camera.zoom=0.3;c.camera.x=0;c.camera.y=0;
z.addZone({id:'z1',name:'Zone',color:'#608ac1',parts:[zm.rectContour(-100,-60,160,120)],holes:[],createdAt:Date.now()});
b.addNote({id:'n1',type:'note',name:'A',text:'a',x:-85,y:-40,width:25,height:null,color:null,createdAt:Date.now(),zoneId:'z1'});
b.addNote({id:'n2',type:'note',name:'B',text:'b',x:0,y:10,width:25,height:null,color:null,createdAt:Date.now()+1,zoneId:'z1'});
(await import('/src/zones/membership.svelte.ts')).recomputeZoneMembership();return 1})()`);
await wait(700);
const w2s = (x, y) => ev(`(async()=>{const c=await import('/src/board/camera.svelte.ts');const m=await import('/src/board/cameraMath.ts');const p=m.worldToScreen(c.camera,c.viewport,{x:${x},y:${y}});const r=document.querySelector('.board').getBoundingClientRect();return [p.x+r.x,p.y+r.y]})()`);
const drag = async (a, b) => { await mouse("mouseMoved", a[0], a[1]); await send("Input.dispatchMouseEvent",{type:"mousePressed",x:a[0],y:a[1],button:"left",buttons:1,clickCount:1}); for (let i=1;i<=10;i++){ await send("Input.dispatchMouseEvent",{type:"mouseMoved",x:a[0]+(b[0]-a[0])*i/10,y:a[1]+(b[1]-a[1])*i/10,button:"left",buttons:1}); await wait(20);} await send("Input.dispatchMouseEvent",{type:"mouseReleased",x:b[0],y:b[1],button:"left",buttons:0,clickCount:1}); await wait(400); };
const sel = () => ev(`(async()=>{const s=await import('/src/selection/selection.svelte.ts');return JSON.stringify({notes:[...s.selection.ids],zones:[...s.selection.zoneIds]})})()`);
console.log("pts", JSON.stringify(await w2s(-120,-80)), JSON.stringify(await w2s(80,80)));
console.log("members:", await ev(`(async()=>JSON.stringify((await import('/src/zones/membership.svelte.ts')).zoneMembers('z1')))()`));
// whole zone, starting outside it
await drag(await w2s(-120, -80), await w2s(80, 80));
console.log("marquee over the whole zone:", await sel());
await click(1300, 760); await wait(300);
// only around the notes (small part of zone)
await drag(await w2s(-95, -50), await w2s(30, 30));
console.log("marquee around the notes only:", await sel());
process.exit(0);
