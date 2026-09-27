// R7 smoke: Inbox quick input + twins (in-app command path), List + Random, Source fields, Map overlay, spellcheck underline + menu.
import { writeFileSync } from "node:fs";
const page = (await fetch(`http://localhost:9334/json/list`).then((r) => r.json())).find((t) => t.type === "page");
const ws = new WebSocket(page.webSocketDebuggerUrl); let id = 0; const pending = new Map();
ws.onmessage = (e) => { const m = JSON.parse(e.data); if (pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } };
await new Promise((r) => (ws.onopen = r));
const send = (method, params = {}) => new Promise((r) => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const ev = async (expression) => { const r = await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true }); return r.result?.result?.value ?? r.result?.exceptionDetails?.exception?.description; };
const mouse = (type, x, y, button = "none", buttons = 0, modifiers = 0) => send("Input.dispatchMouseEvent", { type, x, y, button, buttons, modifiers, clickCount: type === "mousePressed" || type === "mouseReleased" ? 1 : 0 });
const click = async (p, button = "left") => { await mouse("mouseMoved", p.x, p.y); await mouse("mousePressed", p.x, p.y, button, button === "left" ? 1 : 2); await mouse("mouseReleased", p.x, p.y, button, 0); await wait(250); };
const key = async (k, code, vk, modifiers = 0) => { await send("Input.dispatchKeyEvent", { type: "keyDown", key: k, code, windowsVirtualKeyCode: vk, modifiers }); await send("Input.dispatchKeyEvent", { type: "keyUp", key: k, code, windowsVirtualKeyCode: vk, modifiers }); await wait(250); };
const at = (sel) => ev(`(()=>{const e=document.querySelector(${JSON.stringify(sel)});if(!e)return null;const r=e.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}})()`);
const notes = () => ev(`(async()=>{const b=await import('/src/model/board.svelte.ts');return JSON.stringify(Object.values(b.board.notes).map(n=>n.type+':'+n.name+(n.inboxGroup?'(twin)':'')))})()`);

await ev(`(async()=>{const b=await import('/src/model/board.svelte.ts');const c=await import('/src/board/camera.svelte.ts');const n=Date.now();
 b.addNote({id:'in1',type:'inbox',name:'Inbox A',text:'',x:-90,y:-40,width:30,height:null,createdAt:n});
 b.addNote({id:'in2',type:'inbox',name:'Inbox B',text:'',x:40,y:-40,width:30,height:null,createdAt:n+1});
 b.addNote({id:'t1',type:'note',name:'Target',text:'x',x:-90,y:20,width:25,height:null,createdAt:n+2});
 b.addNote({id:'ls',type:'list',name:'List',text:'',x:-40,y:20,width:30,height:null,createdAt:n+3,listItems:[{id:'r1',targetId:'t1',label:'Target'},{id:'r2',targetId:null,label:'plain row'}]});
 b.addNote({id:'rd',type:'random',name:'Random',text:'',x:0,y:20,width:30,height:null,createdAt:n+4});
 const l=await import('/src/model/links.svelte.ts'); l.addLink({id:'lr',from:'ls',to:'rd',kind:'strong',shape:'base'});
 c.camera.x=-10;c.camera.y=0;c.camera.zoom=0.8;return 1})()`);
await wait(600);
// Inbox: submit via the exported function (the in-app path of the event contract)
console.log("inbox submit:", await ev(`(async()=>{const m=await import('/src/inbox/inbox.svelte.ts');const f=m.submitQuickInput;return JSON.stringify(await f('Buy milk\\nand bread'))})()`));
await wait(400);
console.log("after submit (2 twins):", await notes());
const twin = await ev(`(()=>{const e=[...document.querySelectorAll('[data-inbox-twin="true"] [data-note-header]')][0];if(!e)return null;const r=e.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}})()`);
if (twin) await click(twin);
console.log("after clicking one twin (1 left, no twin mark):", await notes());
await key("z", "KeyZ", 90, 2);
console.log("after Ctrl+Z (twins back):", await notes());
// Random pick
const pick = await at('[data-random-pick]');
if (pick) await click(pick);
console.log("random result:", await ev(`document.querySelector('[data-random-result]')?.textContent?.trim()`));
// Map overlay via Shift+M
await mouse("mouseMoved", 700, 500);
await key("M", "KeyM", 77, 8);
console.log("map overlay open:", await ev(`!!document.querySelector('[data-map-overlay]')`));
const mapView = await ev(`(()=>{const e=document.querySelector('[data-map-overlay] [data-map-view]');if(!e)return null;const r=e.getBoundingClientRect();return {x:r.x+r.width*0.8,y:r.y+r.height*0.8}})()`);
if (mapView) await click(mapView);
console.log("camera after map click:", await ev(`(async()=>{const c=await import('/src/board/camera.svelte.ts');return c.camera.x.toFixed(1)+','+c.camera.y.toFixed(1)})()`));
await key("Escape", "Escape", 27);
console.log("map overlay closed:", !(await ev(`!!document.querySelector('[data-map-overlay]')`)));
const shot = await send("Page.captureScreenshot", { format: "png" });
writeFileSync(process.argv[2], Buffer.from(shot.result.data, "base64"));
ws.close();
