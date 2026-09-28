// Debug 9 smoke: Smooth lines (RMB, only X anchors, spacing/corners), List add (mouse + keyboard), Tierlist live drag, Source auto height.
import { writeFileSync } from "node:fs";
const page = (await fetch(`http://localhost:9334/json/list`).then((r) => r.json())).find((t) => t.type === "page");
const ws = new WebSocket(page.webSocketDebuggerUrl); let id = 0; const pending = new Map(); const errors = [];
ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.method === "Runtime.exceptionThrown") errors.push(m.params.exceptionDetails.exception?.description?.slice(0, 200)); if (pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } };
await new Promise((r) => (ws.onopen = r));
const send = (method, params = {}) => new Promise((r) => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
await send("Runtime.enable");
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const ev = async (expression) => { const r = await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true }); return r.result?.result?.value ?? r.result?.exceptionDetails?.exception?.description; };
const mouse = (type, x, y, button = "none", buttons = 0) => send("Input.dispatchMouseEvent", { type, x, y, button, buttons, clickCount: type === "mousePressed" || type === "mouseReleased" ? 1 : 0 });
const click = async (p, button = "left") => { const b = button === "left" ? 1 : 2; await mouse("mouseMoved", p.x, p.y); await mouse("mousePressed", p.x, p.y, button, b); await mouse("mouseReleased", p.x, p.y, button, 0); await wait(250); };
const at = (sel, i = 0) => ev(`(()=>{const e=document.querySelectorAll(${JSON.stringify(sel)})[${i}];if(!e)return null;const r=e.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2,w:r.width,h:r.height}})()`);
const type = async (text) => { for (const ch of text) await send("Input.insertText", { text: ch }); await wait(80); };
const enter = async () => { await send("Input.dispatchKeyEvent", { type: "keyDown", key: "Enter", code: "Enter", windowsVirtualKeyCode: 13, text: "\r" }); await send("Input.dispatchKeyEvent", { type: "keyUp", key: "Enter", code: "Enter", windowsVirtualKeyCode: 13 }); await wait(250); };
const setCam = (x, y, zoom) => ev(`(async()=>{const c=await import('/src/board/camera.svelte.ts');c.camera.x=${x};c.camera.y=${y};c.camera.zoom=${zoom};return 1})()`);


await ev(`(async()=>{const b=await import("/src/model/board.svelte.ts");const l=await import("/src/model/links.svelte.ts");const n=Date.now();
 b.addNote({id:"X",type:"note",name:"X",text:"hub",x:-10,y:-6,width:20,height:null,createdAt:n});
 const ys=[-14,-9,-4,1,6];ys.forEach((y,i)=>b.addNote({id:"o"+i,type:"note",name:"O"+i,text:"",x:30,y,width:12,height:null,createdAt:n+1+i}));
 b.addNote({id:"up",type:"note",name:"Up",text:"",x:-40,y:-45,width:12,height:null,createdAt:n+9});
 b.addNote({id:"lf",type:"note",name:"Left",text:"",x:-40,y:-10,width:12,height:null,createdAt:n+10});
 ["o0","o1","o2","o3","o4","up","lf"].forEach((t,i)=>l.addLink({id:"k"+i,from:i%2?t:"X",to:i%2?"X":t,kind:"strong",shape:"base",fromAnchor:{x:0.5,y:0},toAnchor:{x:0.5,y:1}}));
 return 1})()`);
await setCam(0, -12, 1.1); await wait(500);
await click(await at('[data-note-id="X"] [data-note-header]'), "right"); await wait(300);
const item = await ev(`(()=>{const e=[...document.querySelectorAll("button,[role=menuitem]")].find(b=>b.textContent.trim().startsWith("Smooth lines"));if(!e)return null;const r=e.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}})()`);
if (item) await click(item);
console.log(await ev(`(async()=>{const l=await import("/src/model/links.svelte.ts");const lay=await import("/src/notes/layout.svelte.ts");const b=await import("/src/model/board.svelte.ts");
 const B=lay.noteBounds(b.board.notes.X);const edge=(a)=>a.x<=0.001?"left":a.x>=0.999?"right":a.y<=0.001?"top":"bottom";
 return Object.values(l.links.byId).filter(k=>k.id.startsWith("k")).map(k=>{const o=k.from==="X"?k.to:k.from;const a=k.from==="X"?k.fromAnchor:k.toAnchor;return o+":"+edge(a)}).join(" ")+"  X height u="+B.height.toFixed(1)})()`));
writeFileSync(process.argv[2], Buffer.from((await send("Page.captureScreenshot", { format: "png" })).result.data, "base64"));
console.log("errors:", errors.length ? errors.join(" || ") : "none");
ws.close();
