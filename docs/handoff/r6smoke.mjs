// R6 smoke with real mouse/keys: delete → trash → restore (panel), archive via RMB → restore to centre / duplicate, backups command presence.
import { writeFileSync } from "node:fs";
const page = (await fetch(`http://localhost:9334/json/list`).then((r) => r.json())).find((t) => t.type === "page");
const ws = new WebSocket(page.webSocketDebuggerUrl); let id = 0; const pending = new Map();
ws.onmessage = (e) => { const m = JSON.parse(e.data); if (pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } };
await new Promise((r) => (ws.onopen = r));
const send = (method, params = {}) => new Promise((r) => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const ev = async (expression) => { const r = await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true }); return r.result?.result?.value ?? r.result?.exceptionDetails?.exception?.description; };
const mouse = (type, x, y, button = "none", buttons = 0) => send("Input.dispatchMouseEvent", { type, x, y, button, buttons, clickCount: type === "mousePressed" || type === "mouseReleased" ? 1 : 0 });
const click = async (p, button = "left") => { await mouse("mouseMoved", p.x, p.y); await mouse("mousePressed", p.x, p.y, button, button === "left" ? 1 : 2); await mouse("mouseReleased", p.x, p.y, button, 0); await wait(250); };
const key = async (k, code, vk) => { await send("Input.dispatchKeyEvent", { type: "keyDown", key: k, code, windowsVirtualKeyCode: vk }); await send("Input.dispatchKeyEvent", { type: "keyUp", key: k, code, windowsVirtualKeyCode: vk }); await wait(250); };
const at = (sel) => ev(`(()=>{const e=document.querySelector(${JSON.stringify(sel)});if(!e)return null;const r=e.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}})()`);
const board = () => ev(`(async()=>{const b=await import('/src/model/board.svelte.ts');const l=await import('/src/model/links.svelte.ts');const r=await import('/src/model/retention.svelte.ts');
  return JSON.stringify({notes:Object.values(b.board.notes).map(n=>n.name+'@'+Math.round(n.x)+','+Math.round(n.y)),links:Object.keys(l.links.byId).length,trash:r.trash.entries.length,archive:r.archive.entries.length})})()`);

console.log(await ev(`(async()=>{const b=await import('/src/model/board.svelte.ts');const l=await import('/src/model/links.svelte.ts');const c=await import('/src/board/camera.svelte.ts');const n=Date.now();
 b.addNote({id:'a',type:'note',name:'Alpha',text:'alpha text',x:-60,y:-20,width:25,height:null,createdAt:n});
 b.addNote({id:'b',type:'note',name:'Beta',text:'beta text',x:-20,y:-20,width:25,height:null,createdAt:n+1});
 b.addNote({id:'c',type:'note',name:'Gamma',text:'gamma',x:20,y:-20,width:25,height:null,createdAt:n+2});
 l.addLink({id:'ab',from:'a',to:'b',kind:'strong',shape:'base'});
 c.camera.x=0;c.camera.y=0;c.camera.zoom=1;return 'ok'})()`));
await wait(600);
console.log("0 start:", await board());
// 1. select Beta by header click, press Delete
await click(await at('[data-note-id="b"] [data-note-header]'));
await key("Delete", "Delete", 46);
console.log("1 after Delete (Beta gone, trash 1, link 0):", await board());
// 2. open trash panel via top-bar button and restore
const trashBtn = await ev(`(()=>{const e=[...document.querySelectorAll('button')].find(b=>b.textContent.trim()==='Trash');if(!e)return null;const r=e.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}})()`);
console.log("trash button:", JSON.stringify(trashBtn));
if (trashBtn) await click(trashBtn);
const restoreBtn = await ev(`(()=>{const e=[...document.querySelectorAll('button')].find(b=>/^Restore$/i.test(b.textContent.trim()));if(!e)return null;const r=e.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}})()`);
console.log("restore button:", JSON.stringify(restoreBtn));
if (restoreBtn) { await click(restoreBtn); const confirm = await ev(`(()=>{const e=[...document.querySelectorAll('button')].find(b=>/^Confirm/i.test(b.textContent.trim()));if(!e)return null;const r=e.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}})()`); if (confirm) await click(confirm); }
console.log("2 after restore (Beta back, link back, trash 0):", await board());
await key("Escape", "Escape", 27);
// 3. archive Gamma via RMB
await click(await at('[data-note-id="c"] [data-note-header]'), "right");
const archiveItem = await ev(`(()=>{const e=[...document.querySelectorAll('button,[role=menuitem]')].find(b=>/^Archive/i.test(b.textContent.trim()));if(!e)return null;const r=e.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}})()`);
console.log("archive menu item:", JSON.stringify(archiveItem));
if (archiveItem) await click(archiveItem);
console.log("3 after archive (Gamma gone, archive 1):", await board());
// 4. Archive node: create and use restore-to-centre
await ev(`(async()=>{const b=await import('/src/model/board.svelte.ts');b.addNote({id:'arc',type:'archive',name:'Archive',text:'',x:-60,y:20,width:40,height:null,createdAt:Date.now()});return 1})()`);
await wait(400);
const dup = await at('[data-archive-duplicate]');
if (dup) await click(dup);
console.log("4 after duplicate (copy of Gamma near Archive, archive still 1):", await board());
const centre = await at('[data-archive-restore-centre]');
if (centre) await click(centre);
console.log("5 after restore to centre (Gamma at ~centre, archive 0):", await board());
console.log("F3 commands:", await ev(`(async()=>{const r=await import('/src/commands/registry.svelte.ts');const all=(r.getCommands?.()??[]).map(c=>c.label);return all.filter(l=>/snapshot|backup|health|export|import|trash|archive/i.test(l)).join(' | ')})()`));
const shot = await send("Page.captureScreenshot", { format: "png" });
writeFileSync(process.argv[2], Buffer.from(shot.result.data, "base64"));
ws.close();
