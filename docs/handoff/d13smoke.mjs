// Debug 13 smoke: Task→Message merge with drop target, pull-out, resize of a combined node, line-mode RMB menus, zone Resize → select, move opacity, Importance over Mark as.
const page = (await fetch(`http://localhost:9334/json/list`).then((r) => r.json())).find((t) => t.type === "page");
const ws = new WebSocket(page.webSocketDebuggerUrl); let id = 0; const pending = new Map(); const errors = [];
ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.method === "Runtime.exceptionThrown") errors.push(m.params.exceptionDetails.exception?.description?.slice(0, 200)); if (pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } };
await new Promise((r) => (ws.onopen = r));
const send = (method, params = {}) => new Promise((r) => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
await send("Runtime.enable");
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const ev = async (expression) => { const r = await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true }); return r.result?.result?.value ?? r.result?.exceptionDetails?.exception?.description; };
const mouse = (type, x, y, button = "none", buttons = 0) => send("Input.dispatchMouseEvent", { type, x, y, button, buttons, clickCount: type === "mousePressed" || type === "mouseReleased" ? 1 : 0 });
const click = async (p, button = "left") => { await mouse("mouseMoved", p.x, p.y); await mouse("mousePressed", p.x, p.y, button, button === "left" ? 1 : 2); await mouse("mouseReleased", p.x, p.y, button, 0); await wait(300); };
const at = (sel) => ev(`(()=>{const e=document.querySelector(${JSON.stringify(sel)});if(!e)return null;const r=e.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2,l:r.left,r:r.right,t:r.top,b:r.bottom,w:r.width,h:r.height}})()`);
const menu = () => ev(`[...document.querySelectorAll('[data-note-menu] button,[data-zone-menu] button,[role=menuitem]')].map(b=>b.textContent.trim()).filter(Boolean).slice(0,6).join(' | ')||'none'`);
const esc = async () => { await send("Input.dispatchKeyEvent", { type: "rawKeyDown", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 }); await send("Input.dispatchKeyEvent", { type: "keyUp", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 }); await wait(250); };
const tool = (t) => ev(`(async()=>{const m=await import('/src/tools/tool.svelte.ts');${t ? `m.tool.active='${t}';` : ""}return m.tool.active})()`);
await ev(`(async()=>{const b=await import('/src/model/board.svelte.ts');const z=await import('/src/model/zones.svelte.ts');const g=await import('/src/model/zone.ts');const c=await import('/src/notes/noteCommands.ts');const t=await import('/src/tasks/taskActions.svelte.ts');const cam=await import('/src/board/camera.svelte.ts');
 for(const i of [...b.board.order])b.removeNote(i);for(const i of [...z.zones.order])z.removeZone(i);
 b.addNote({id:'task',type:'note',name:'Task host',text:'',x:-60,y:-30,width:30,height:null,createdAt:Date.now()});t.toggleTaskFlag('task');
 const m=c.createNoteKind('message');b.updateNote(m,{x:10,y:-30,text:'msg'});window.__m=m;
 z.addZone({id:'zz',name:'Zone 1',color:'#6a9fd4',parts:[g.rectContour(-70,20,60,30)],holes:[],createdAt:Date.now()});
 cam.camera.x=-10;cam.camera.y=5;cam.camera.zoom=0.85;return 1})()`);
await wait(600);
const M = await ev("window.__m");
// 9.1 Task dragged onto Message: drop target during drag, merge on release
const th = await at('[data-note-id="task"] [data-note-header]'); const mm = await at(`[data-note-id="${M}"]`);
await mouse("mouseMoved", th.x, th.y); await mouse("mousePressed", th.x, th.y, "left", 1);
for (let i = 1; i <= 12; i += 1) { await mouse("mouseMoved", th.x + (mm.x - th.x) * i / 12, th.y + (mm.y - th.y) * i / 12, "left", 1); await wait(30); }
console.log("[9.1] drop target shown:", await ev(`!!document.querySelector('[data-combo-drop-target]')`), "| moving card opacity:", await ev(`getComputedStyle(document.querySelector('[data-note-id="task"]')).opacity`));
await mouse("mouseReleased", mm.x, mm.y, "left", 0); await wait(500);
console.log("[9.1] after drop:", await ev(`(async()=>{const b=await import('/src/model/board.svelte.ts');const n=Object.values(b.board.notes).find(x=>x.message);return n?('host '+n.id+' type '+n.type+' task:'+!!n.task+' sections '+[...document.querySelectorAll('[data-note-id="'+n.id+'"] [data-combo-section]')].map(e=>e.getAttribute('data-combo-section')).join(',')):'no merge'})()`));
const hostId = await ev(`(async()=>{const b=await import('/src/model/board.svelte.ts');return Object.values(b.board.notes).find(x=>x.message)?.id})()`);
console.log("[10] opacity after drop:", await ev(`getComputedStyle(document.querySelector('[data-note-id="${hostId}"]')).opacity`));
// 9.4 bigger body; 9.3 resize host wider/narrower
console.log("[9.4] host text area height px:", await ev(`Math.round(document.querySelector('[data-note-id="${hostId}"] [data-note-body]')?.getBoundingClientRect().height ?? 0)`));
await click(await at(`[data-note-id="${hostId}"] [data-note-header]`));
const rh = await at('[data-resize-handle="right"]');
const secW0 = await ev(`Math.round(document.querySelector('[data-note-id="${hostId}"] [data-combo-section]').getBoundingClientRect().width)`);
if (rh) { await mouse("mouseMoved", rh.x, rh.y); await mouse("mousePressed", rh.x, rh.y, "left", 1); for (let i = 1; i <= 8; i += 1) { await mouse("mouseMoved", rh.x + i * 20, rh.y, "left", 1); await wait(25); } await mouse("mouseReleased", rh.x + 160, rh.y, "left", 0); await wait(400); }
console.log("[9.3] widen: section width px", secW0, "→", await ev(`Math.round(document.querySelector('[data-note-id="${hostId}"] [data-combo-section]').getBoundingClientRect().width)`), "| host width u:", await ev(`(async()=>{const b=await import('/src/model/board.svelte.ts');return b.board.notes['${hostId}'].width})()`));
const rh2 = await at('[data-resize-handle="right"]');
if (rh2) { await mouse("mouseMoved", rh2.x, rh2.y); await mouse("mousePressed", rh2.x, rh2.y, "left", 1); for (let i = 1; i <= 10; i += 1) { await mouse("mouseMoved", rh2.x - i * 40, rh2.y, "left", 1); await wait(25); } await mouse("mouseReleased", rh2.x - 400, rh2.y, "left", 0); await wait(400); }
console.log("[9.3] shrink hard: host width u:", await ev(`(async()=>{const b=await import('/src/model/board.svelte.ts');return b.board.notes['${hostId}'].width})()`), "sections:", await ev(`[...document.querySelectorAll('[data-note-id="${hostId}"] [data-combo-section]')].map(e=>e.getAttribute('data-combo-section')).join(',')`));
// 9.2 pull-out by the section background
const sec = await at(`[data-note-id="${hostId}"] [data-combo-section="message"]`);
if (sec) { const p = { x: sec.r - 8, y: sec.b - 4 }; await mouse("mouseMoved", p.x, p.y); await mouse("mousePressed", p.x, p.y, "left", 1); for (let i = 1; i <= 10; i += 1) { await mouse("mouseMoved", p.x + i * 25, p.y + i * 8, "left", 1); await wait(25); } await mouse("mouseReleased", p.x + 250, p.y + 80, "left", 0); await wait(500); }
console.log("[9.2] after pull-out:", await ev(`(async()=>{const b=await import('/src/model/board.svelte.ts');return 'host has message: '+!!b.board.notes['${hostId}'].message+' | message nodes: '+Object.values(b.board.notes).filter(n=>n.type==='message').length})()`));
// 2 / 3 line mode
await tool("line-strong");
await click(await at(`[data-note-id="${hostId}"]`), "right");
console.log("[2] line mode RMB on node:", await menu()); await esc();
const zc = await ev(`(()=>{const p=document.querySelector('[data-zone-id="zz"] path').getBoundingClientRect();return {x:p.x+p.width/2,y:p.y+p.height/2}})()`);
await click(zc, "right");
console.log("[2] line mode RMB on zone:", await menu());
const rz = await ev(`(()=>{const e=[...document.querySelectorAll('button')].find(b=>b.textContent.trim()==='Resize');if(!e)return null;const r=e.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}})()`);
if (rz) await click(rz);
console.log("[3] after Resize: tool =", await tool(), "| handles:", await ev(`document.querySelectorAll('[data-zone-resize-handle]').length`));
await esc(); await click({ x: 1300, y: 750 });
// 11 importance over mark as
await ev(`(async()=>{const b=await import('/src/model/board.svelte.ts');b.updateNote('${hostId}',{importance:'important',customMarks:[{id:'m1',text:'tag',color:'#5cd8ff'}],customMarkFrame:true});return 1})()`); await wait(300);
console.log("[11] node frame: importance", await ev(`document.querySelector('[data-note-id="${hostId}"]').getAttribute('data-importance')`), "| custom mark frame attr:", await ev(`document.querySelector('[data-note-id="${hostId}"]').getAttribute('data-custom-mark-frame')`));
console.log("errors:", errors.length ? errors.join(" || ") : "none");
ws.close();
