// Hide header: RMB → Hide header on a note and a tierlist; header gone, node shorter; drag by body moves it; Undo; Show header.
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
const click = async (p, button = "left") => { const b = button === "left" ? 1 : 2; await mouse("mouseMoved", p.x, p.y); await mouse("mousePressed", p.x, p.y, button, b); await mouse("mouseReleased", p.x, p.y, button, 0); await wait(300); };
const at = (sel) => ev(`(()=>{const e=document.querySelector(${JSON.stringify(sel)});if(!e)return null;const r=e.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2,h:r.height,t:r.top,l:r.left}})()`);
const menuItem = async (label) => { const p = await ev(`(()=>{const e=[...document.querySelectorAll('button,[role=menuitem]')].find(b=>b.textContent.trim().startsWith(${JSON.stringify(label)}));if(!e)return null;const r=e.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}})()`); if (p) await click(p); return !!p; };
const key = async (k, code, vk, mods = 0) => { await send("Input.dispatchKeyEvent", { type: "keyDown", key: k, code, windowsVirtualKeyCode: vk, modifiers: mods }); await send("Input.dispatchKeyEvent", { type: "keyUp", key: k, code, windowsVirtualKeyCode: vk, modifiers: mods }); await wait(300); };
await ev(`(async()=>{const b=await import('/src/model/board.svelte.ts');const c=await import('/src/board/camera.svelte.ts');const n=Date.now();
 b.addNote({id:'tx',type:'note',name:'Text note',text:'hello world',x:-45,y:-15,width:25,height:null,createdAt:n});
 b.addNote({id:'tl',type:'tierlist',name:'Tierlist',text:'',x:-10,y:-15,width:60,height:null,createdAt:n+1,tiers:[{id:'rS',name:'S',color:'#e58b83',cards:[{id:'c1',kind:'text',text:'one'}]}]});
 c.camera.x=5;c.camera.y=0;c.camera.zoom=1;return 1})()`);
await wait(600);
for (const nid of ["tx", "tl"]) {
  const h0 = (await at(`[data-note-id="${nid}"]`)).h;
  await click(await at(`[data-note-id="${nid}"] [data-note-header]`), "right");
  const ok = await menuItem("Hide header");
  const after = await at(`[data-note-id="${nid}"]`);
  console.log(nid, "menu item:", ok, "header present:", !!(await at(`[data-note-id="${nid}"] [data-note-header]`)), "height px", Math.round(h0), "→", Math.round(after.h));
}
// drag headerless text note by its body
const body = await at('[data-note-id="tx"] [data-note-body]') ?? await at('[data-note-id="tx"]');
const x0 = await ev(`(async()=>{const b=await import('/src/model/board.svelte.ts');return b.board.notes.tx.x})()`);
await mouse("mouseMoved", body.x, body.y); await mouse("mousePressed", body.x, body.y, "left", 1);
for (let i = 1; i <= 8; i += 1) { await mouse("mouseMoved", body.x - i * 10, body.y + i * 5, "left", 1); await wait(25); }
await mouse("mouseReleased", body.x - 80, body.y + 40, "left", 0); await wait(300);
console.log("text note moved by body: dx u =", (await ev(`(async()=>{const b=await import('/src/model/board.svelte.ts');return b.board.notes.tx.x})()`)) - x0);
writeFileSync(process.argv[2], Buffer.from((await send("Page.captureScreenshot", { format: "png" })).result.data, "base64"));
await key("z", "KeyZ", 90, 2); await key("z", "KeyZ", 90, 2);
console.log("after 2x Ctrl+Z tierlist header back:", !!(await at('[data-note-id="tl"] [data-note-header]')));
await click(await at('[data-note-id="tx"]'), "right");
console.log("Show header offered:", await menuItem("Show header"), "header back:", !!(await at('[data-note-id="tx"] [data-note-header]')));
console.log("errors:", errors.length ? errors.join(" || ") : "none");
ws.close();
