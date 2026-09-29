// Debug 11 smoke: every browser-checkable item of the user's list, real mouse/keyboard where it matters.
import { writeFileSync } from "node:fs";
const page = (await fetch(`http://localhost:9334/json/list`).then((r) => r.json())).find((t) => t.type === "page");
const ws = new WebSocket(page.webSocketDebuggerUrl); let id = 0; const pending = new Map(); const errors = [];
ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.method === "Runtime.exceptionThrown") errors.push(m.params.exceptionDetails.exception?.description?.slice(0, 200)); if (pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } };
await new Promise((r) => (ws.onopen = r));
const send = (method, params = {}) => new Promise((r) => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
await send("Runtime.enable");
const shotDir = process.argv[2] ?? "C:/Users/reteren/AppData/Local/Temp/claude";
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const ev = async (expression) => { const r = await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true }); return r.result?.result?.value ?? r.result?.exceptionDetails?.exception?.description; };
const mouse = (type, x, y, button = "none", buttons = 0, modifiers = 0) => send("Input.dispatchMouseEvent", { type, x, y, button, buttons, modifiers, clickCount: type === "mousePressed" || type === "mouseReleased" ? 1 : 0 });
const click = async (p, button = "left", mods = 0) => { const b = button === "left" ? 1 : 2; await mouse("mouseMoved", p.x, p.y, "none", 0, mods); await mouse("mousePressed", p.x, p.y, button, b, mods); await mouse("mouseReleased", p.x, p.y, button, 0, mods); await wait(300); };
const drag = async (a, b, mods = 0, steps = 10) => { await mouse("mouseMoved", a.x, a.y, "none", 0, mods); await mouse("mousePressed", a.x, a.y, "left", 1, mods); for (let i = 1; i <= steps; i += 1) { await mouse("mouseMoved", a.x + (b.x - a.x) * i / steps, a.y + (b.y - a.y) * i / steps, "left", 1, mods); await wait(25); } await mouse("mouseReleased", b.x, b.y, "left", 0, mods); await wait(350); };
const at = (sel) => ev(`(()=>{const e=document.querySelector(${JSON.stringify(sel)});if(!e)return null;e.scrollIntoView?.({block:"nearest"});const r=e.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2,l:r.left,t:r.top,r:r.right,b:r.bottom,w:r.width,h:r.height}})()`);
const key = async (k, code, vk, mods = 0, type = "both") => { if (type !== "up") await send("Input.dispatchKeyEvent", { type: "rawKeyDown", key: k, code, windowsVirtualKeyCode: vk, modifiers: mods }); if (type !== "down") await send("Input.dispatchKeyEvent", { type: "keyUp", key: k, code, windowsVirtualKeyCode: vk, modifiers: mods }); await wait(250); };
const esc = () => key("Escape", "Escape", 27);
const menuItems = () => ev(`[...document.querySelectorAll('[data-note-menu] button,[data-zone-menu] button,[role=menuitem]')].map(b=>b.textContent.trim()).filter(Boolean).join(' | ')`);
const menuClick = async (label) => { const p = await ev(`(()=>{const e=[...document.querySelectorAll('button,[role=menuitem]')].find(b=>b.textContent.trim().startsWith(${JSON.stringify(label)}));if(!e)return null;const r=e.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}})()`); if (p) await click(p); return !!p; };
const sel = () => ev(`(async()=>{const s=await import('/src/selection/selection.svelte.ts');return s.selection.ids.join(',')||'-'})()`);
const note = (nid, expr) => ev(`(async()=>{const b=await import('/src/model/board.svelte.ts');const n=b.board.notes['${nid}'];return JSON.stringify(${expr})})()`);
const shot = async (name) => writeFileSync(`${shotDir}/d11-${name}.png`, Buffer.from((await send("Page.captureScreenshot", { format: "png" })).result.data, "base64"));
const setCam = (x, y, z) => ev(`(async()=>{const c=await import('/src/board/camera.svelte.ts');c.camera.x=${x};c.camera.y=${y};c.camera.zoom=${z};return 1})()`);
const clearBoard = () => ev(`(async()=>{const b=await import('/src/model/board.svelte.ts');const z=await import('/src/model/zones.svelte.ts');for(const id of [...b.board.order])b.removeNote(id);for(const id of [...z.zones.order])z.removeZone(id);return 1})()`);
const log = (item, ...rest) => console.log(`[${item}]`, ...rest);

// ---------- Time: 2, 3, 4, 7, 10 ----------
await clearBoard();
await ev(`(async()=>{const c=await import('/src/notes/noteCommands.ts');window.__t=c.createNoteKind('time');return 1})()`);
const T = await ev("window.__t");
await ev(`(async()=>{const b=await import('/src/model/board.svelte.ts');const n=b.board.notes['${T}'];b.updateNote('${T}',{x:-20,y:-20,time:{...n.time,schedule:{kind:'interval',minutes:5,mode:'calendar',repeat:false},enabled:false}});return 1})()`);
await setCam(0, 0, 1); await wait(500);
log(3, "native <select> count in Time:", await ev(`document.querySelectorAll('[data-note-id="${T}"] select').length`), "styled listbox:", await ev(`!!document.querySelector('[data-note-id="${T}"] [role=listbox],[data-note-id="${T}"] [aria-haspopup=listbox]')`));
log(4, "number spinner hidden:", await ev(`(()=>{const i=document.querySelector('[data-note-id="${T}"] input[type=number]');if(!i)return 'no number input';return getComputedStyle(i).appearance+' / -moz:'+getComputedStyle(i).getPropertyValue('-moz-appearance')})()`));
const cb = async (label) => at(`[data-note-id="${T}"] label:has(input[type=checkbox])${label}`);
const checkboxes = await ev(`[...document.querySelectorAll('[data-note-id="${T}"] input[type=checkbox]')].map(i=>(i.closest('label')?.textContent.trim()||'?')+'='+i.checked).join(', ')`);
log(2, "before:", checkboxes);
const enabledBox = await ev(`(()=>{const i=[...document.querySelectorAll('[data-note-id="${T}"] input[type=checkbox]')].find(i=>/enabled/i.test(i.closest('label')?.textContent||''));if(!i)return null;const r=i.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}})()`);
if (enabledBox) await click(enabledBox);
log(2, "after clicking Enabled:", await ev(`[...document.querySelectorAll('[data-note-id="${T}"] input[type=checkbox]')].map(i=>(i.closest('label')?.textContent.trim()||'?')+'='+i.checked).join(', ')`), "status:", await ev(`document.querySelector('[data-note-id="${T}"] [data-time-status]')?.textContent.trim()`));
if (enabledBox) await click(enabledBox);
log(7, "after disabling:", await ev(`document.querySelector('[data-note-id="${T}"] [data-time-status]')?.textContent.trim()`), "runtime:", await note(T, "n.time.runtime ?? null"));
await shot("time");
// Stopwatch
const swPill = await ev(`(()=>{const e=[...document.querySelectorAll('[data-note-id="${T}"] .time-view-switch button')].find(b=>b.textContent.trim()==='Stopwatch');if(!e)return null;const r=e.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}})()`);
log(10, "pills present:", !!swPill);
if (swPill) await click(swPill);
await wait(1200);
log(10, "view:", await note(T, "n.time.view"), "counter:", await ev(`document.querySelector('[data-note-id="${T}"] [data-stopwatch-counter]')?.textContent.replace(/\\s+/g,' ').trim()`), "toggle present (default mode):", !!(await at(`[data-note-id="${T}"] [data-stopwatch-toggle]`)), "project-base checkbox:", await ev(`(()=>{const i=document.querySelector('[data-note-id="${T}"] [data-stopwatch-project-base]');return i?('checked='+i.checked+' disabled='+i.disabled):'none'})()`), "conditions:", !!(await at(`[data-note-id="${T}"] [data-stopwatch-conditions]`)));
await shot("stopwatch");

// ---------- Message: 5, 6, 8, 9, 26, 27 ----------
await clearBoard();
await ev(`(async()=>{const b=await import('/src/model/board.svelte.ts');const l=await import('/src/model/links.svelte.ts');const c=await import('/src/notes/noteCommands.ts');const t=await import('/src/tasks/taskActions.svelte.ts');
 const tid=c.createNoteKind('time');const mid=c.createNoteKind('message');window.__tm=[tid,mid];
 b.updateNote(mid,{text:'message text',x:20,y:-20});b.updateNote(tid,{x:-30,y:-20});
 b.addNote({id:'task1',type:'note',name:'Task one',text:'do the task',x:20,y:20,width:25,height:null,createdAt:Date.now(),importance:'important'});t.toggleTaskFlag('task1');
 l.addLink({id:'l1',from:tid,to:mid,kind:'strong',shape:'base'});l.addLink({id:'l2',from:'task1',to:mid,kind:'strong',shape:'base'});
 const n=b.board.notes[tid];b.updateNote(tid,{time:{schedule:{kind:'interval',minutes:1,mode:'calendar',repeat:false},enabled:true,runtime:{intervalStartedAt:Date.now()-70000}}});return 1})()`);
await setCam(0, 0, 1); await wait(2600);
const [TT, MM] = JSON.parse(await ev("JSON.stringify(window.__tm)"));
log(27, "Hide after control present:", await ev(`/hide after/i.test(document.querySelector('[data-note-id="${MM}"]')?.textContent||'')`));
log(5, "card text:", await ev(`[...document.querySelectorAll('[data-shown-message]')].map(e=>e.textContent.replace(/\\s+/g,' ').trim()).join(' | ')||'none'`));
log(8, "card bg/border:", await ev(`(()=>{const c=document.querySelector('[data-shown-message]');if(!c)return 'no card';const s=getComputedStyle(c);return s.backgroundColor+' / '+s.borderColor})()`));
log(6, "importance attr:", await ev(`document.querySelector('[data-shown-message]')?.getAttribute('data-message-importance')`));
log(26, "card animation:", await ev(`(()=>{const c=document.querySelector('[data-shown-message]');if(!c)return 'no card';const s=getComputedStyle(c);return s.animationName+' '+s.animationDuration})()`));
await shot("message-card");
const go = await at("[data-message-go-to]"); if (go) await click(go);
log(5, "Go to selected:", await sel(), "(expected task1)");
// 9: hide header on Message node → card without header
await ev(`(async()=>{const b=await import('/src/model/board.svelte.ts');b.updateNote('${MM}',{headerHidden:true});const r=await import('/src/time/runtime.svelte.ts');b.updateNote('${TT}',{time:{schedule:{kind:'interval',minutes:1,mode:'calendar',repeat:false},enabled:true,runtime:{intervalStartedAt:Date.now()-70000}}});return 1})()`);
await wait(2600);
log(9, "cards:", await ev(`document.querySelectorAll('[data-shown-message]').length`), "headers in newest card:", await ev(`document.querySelector('[data-shown-message]')?.querySelectorAll('[data-message-card-header]').length`));
for (let i = 0; i < 5; i += 1) { const c = await at("[data-message-close]"); if (!c) break; await click(c); }

// ---------- Visual: 14, 15, 16, 21, 22 ----------
await clearBoard();
await ev(`(async()=>{const b=await import('/src/model/board.svelte.ts');const n=Date.now();b.addNote({id:'mk',type:'markas',name:'Mark as',text:'',x:-40,y:-20,width:30,height:null,createdAt:n});b.addNote({id:'st',type:'stats',name:'Statistics',text:'',x:0,y:-20,width:30,height:null,createdAt:n+1});return 1})()`);
await setCam(0, 0, 1); await wait(500);
log(14, "user-select of Mark as labels:", await ev(`[...document.querySelectorAll('[data-note-id="mk"] .markas-field-name, [data-note-id="mk"] .markas-frame span')].map(e=>getComputedStyle(e).userSelect).join(',')`));
log(15, "Statistics description present:", await ev(`/Text notes only/.test(document.querySelector('[data-note-id="st"]')?.textContent||'')`));
log(16, "scrollbar CSS rules:", await ev(`[...document.styleSheets].flatMap(s=>{try{return [...s.cssRules]}catch{return []}}).map(r=>r.cssText).filter(t=>/scrollbar-track|scrollbar-color/.test(t)).slice(0,3).join(' || ').slice(0,300)`));
await click(await at(".grid-controls button[aria-haspopup], [data-grid-panel-toggle], .grid-menu-toggle") ?? { x: 788, y: 31 });
await wait(300);
log(21, "Auto grid checkbox:", await ev(`(()=>{const i=document.querySelector('[data-auto-grid]');return i?('checked='+(i.checked??i.getAttribute('aria-checked'))):'none'})()`));
log(22, "increase/decrease hint present:", await ev(`/Right-click to decrease/.test(document.body.textContent)`));
await shot("grid");
await esc(); await click({ x: 700, y: 700 });

// ---------- Selection / headers / menus: 12, 13, 17, 19, 23 ----------
await clearBoard();
await ev(`(async()=>{const b=await import('/src/model/board.svelte.ts');const n=Date.now();
 b.addNote({id:'ls',type:'list',name:'List',text:'',x:-50,y:-30,width:30,height:null,createdAt:n,listStats:true,listItems:[{id:'r1',targetId:null,label:'row one'}]});
 b.addNote({id:'hh',type:'note',name:'Hidden head',text:'body text',x:10,y:-30,width:25,height:null,createdAt:n+1,headerHidden:true});
 b.addNote({id:'mk2',type:'markas',name:'Mark as',text:'',x:10,y:5,width:30,height:null,createdAt:n+2});
 b.addNote({id:'a',type:'note',name:'A',text:'a',x:-50,y:15,width:15,height:null,createdAt:n+3});
 b.addNote({id:'c',type:'note',name:'C',text:'c',x:-30,y:15,width:15,height:null,createdAt:n+4});return 1})()`);
await setCam(-5, 0, 1); await wait(500);
const lsx0 = JSON.parse(await note("ls", "n.x"));
const lh = await at('[data-note-id="ls"] [data-note-header]');
await drag(lh, { x: lh.x + 60, y: lh.y });
log(12, "List+Statistics moved by header: dx u =", JSON.parse(await note("ls", "n.x")) - lsx0);
const hh = await at('[data-note-id="hh"]'); await mouse("mouseMoved", hh.x, hh.y); await wait(300);
log(13, "hidden header on hover opacity:", await ev(`(()=>{const h=document.querySelector('[data-note-id="hh"] [data-note-header]');return h?getComputedStyle(h).opacity:'no header element'})()`));
await click(await at('[data-note-id="mk2"]'), "right");
log(17, "RMB centre of Mark as → app menu items:", (await menuItems()).slice(0, 120) || "none");
await esc();
await click(await at('[data-note-id="a"] [data-note-header]'));
await click(await at('[data-note-id="c"] [data-note-header]'), "left", 2);
log(19, "selected:", await sel());
const ax0 = JSON.parse(await note("a", "n.x"));
const ga = await at('[data-note-id="a"]'); const gc = await at('[data-note-id="c"]');
const inside = { x: (ga.r + gc.l) / 2, y: Math.max(ga.b, gc.b) - 3 };
await drag(inside, { x: inside.x + 50, y: inside.y + 20 });
log(19, "drag from empty point inside selection frame: A dx u =", JSON.parse(await note("a", "n.x")) - ax0);
await click(await at('[data-note-id="a"] [data-note-header]'));
const pa = await at('[data-note-id="a"]'); await mouse("mouseMoved", pa.x + 60, pa.y); await key("s", "KeyS", 83);
log(23, "S hint shown:", !!(await at("[data-transform-mode-hint]")));
await esc();

// ---------- Zones: 1 ----------
await clearBoard();
await ev(`(async()=>{const z=await import('/src/model/zones.svelte.ts');const b=await import('/src/model/board.svelte.ts');const g=await import('/src/model/zone.ts');
 z.addZone({id:'z1',name:'Zone A',color:'#6a9fd4',parts:[g.rectContour(-60,-35,90,60)],holes:[],createdAt:Date.now()});
 b.addNote({id:'n1',type:'note',name:'N1',text:'x',x:-40,y:-15,width:15,height:null,createdAt:Date.now()});
 b.addNote({id:'n2',type:'note',name:'N2',text:'y',x:-10,y:-15,width:15,height:null,createdAt:Date.now()+1});return 1})()`);
await setCam(-15, -5, 1); await wait(500);
const zStart = await ev(`(()=>{const r=document.querySelector('[data-note-id="n1"]').getBoundingClientRect();return {x:r.left-40,y:r.top-40}})()`);
const n2 = await at('[data-note-id="n2"]');
await drag(zStart, { x: n2.r + 10, y: n2.b + 10 });
log(1, "marquee from inside zone selects:", await sel(), "| zone handles visible:", await ev(`document.querySelectorAll('[data-zone-resize-handle],[data-zone-handle]').length`));
await click({ x: zStart.x, y: zStart.y + 150 }, "right");
log(1, "zone RMB menu:", (await menuItems()).slice(0, 150));
const hadResize = await menuClick("Resize");
log(1, "Resize clicked:", hadResize, "handles:", await ev(`document.querySelectorAll('[data-zone-resize-handle],[data-zone-handle],[data-resize-handle]').length`));
await shot("zone-resize");
await esc();

// ---------- Alt overview: 24 ----------
await clearBoard();
await ev(`(async()=>{const b=await import('/src/model/board.svelte.ts');const n=Date.now();b.addNote({id:'o1',type:'note',name:'Note 5',text:'text',x:-30,y:-15,width:25,height:null,createdAt:n});b.addNote({id:'o2',type:'stats',name:'Statistics',text:'',x:5,y:-15,width:30,height:null,createdAt:n+1});b.addNote({id:'bc',type:'beacon',name:'Hub',text:'',x:-30,y:20,width:7.2,height:7.2,color:'#c85a5a',createdAt:n+2});return 1})()`);
await setCam(0, 0, 1); await wait(400);
await key("Alt", "AltLeft", 18, 1, "down"); await wait(400);
log(24, "overview on while Alt held:", await ev(`!!document.querySelector('[data-alt-overview]')`), "labels:", await ev(`[...document.querySelectorAll('[data-overview-node-label],[data-overview-beacon-label]')].map(e=>e.textContent.replace(/\\s+/g,' ').trim()).join(' | ')`));
await shot("overview");
await key("Alt", "AltLeft", 18, 0, "up"); await wait(300);
log(24, "overview off after release:", !(await ev(`!!document.querySelector('[data-alt-overview]')`)));

console.log("errors:", errors.length ? errors.join(" || ") : "none");
ws.close();
