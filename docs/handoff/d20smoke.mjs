// Debug 20 smoke (after 1.4.5): md -> text note with fitted height, locked Source (no Choose file), video frame menu + volume popover size, Tierlist media cards, PDF content/node ratio across board zoom, header name not selectable.
import { writeFileSync } from "node:fs";
const page = (await fetch(`http://localhost:9334/json/list`).then((r) => r.json())).find((t) => t.type === "page");
const ws = new WebSocket(page.webSocketDebuggerUrl); let id = 0; const pending = new Map(); const errors = [];
ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.method === "Runtime.exceptionThrown") errors.push(m.params.exceptionDetails.exception?.description?.slice(0, 200)); if (pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } };
await new Promise((r) => (ws.onopen = r));
const send = (method, params = {}) => new Promise((r) => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
await send("Runtime.enable");
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const ev = async (expression) => { const r = await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true }); return r.result?.result?.value ?? r.result?.exceptionDetails?.exception?.description; };
const mouse = (type, x, y, button = "none", buttons = 0) => send("Input.dispatchMouseEvent", { type, x, y, button, buttons, clickCount: type === "mouseMoved" ? 0 : 1 });
const pos = (expr) => ev(`(()=>{const e=${expr};if(!e)return null;const r=e.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2,w:r.width,h:r.height}})()`);
const click = async (p, button = "left") => { await mouse("mouseMoved", p.x, p.y); await mouse("mousePressed", p.x, p.y, button, button === "left" ? 1 : 2); await mouse("mouseReleased", p.x, p.y, button, 0); await wait(300); };
const shot = async (n) => writeFileSync(`C:/Users/reteren/AppData/Local/Temp/claude/${n}.png`, Buffer.from((await send("Page.captureScreenshot", { format: "png" })).result.data, "base64"));
const menu = () => ev(`[...document.querySelectorAll('[role=menu]')].filter(m=>m.offsetWidth).map(m=>[...m.querySelectorAll('button,[role=menuitem]')].filter(b=>b.offsetWidth).map(b=>b.innerText.replace(/\\s+/g,' ').trim()).filter(Boolean).join(' | ')).join(' || ')`);

await ev(`(async()=>{const b=await import('/src/model/board.svelte.ts');const cam=await import('/src/board/camera.svelte.ts');const h=await import('/src/history/history.svelte.ts');for(const i of [...b.board.order])b.removeNote(i);h.clear();cam.camera.x=0;cam.camera.y=0;cam.camera.zoom=0.8;
 window.__webm=async()=>{const cv=document.createElement('canvas');cv.width=320;cv.height=180;const x=cv.getContext('2d');const st=cv.captureStream(15);const rec=new MediaRecorder(st,{mimeType:'video/webm'});const parts=[];rec.ondataavailable=e=>parts.push(e.data);rec.start();let f=0;const t=setInterval(()=>{x.fillStyle='hsl('+(f*20)+',60%,40%)';x.fillRect(0,0,320,180);f++},66);await new Promise(r=>setTimeout(r,2500));clearInterval(t);rec.stop();await new Promise(r=>rec.onstop=r);return new File([new Blob(parts,{type:'video/webm'})],'clip.webm',{type:'video/webm'})};
 return 1})()`);
// 3: md -> text note
console.log("3 md note:", await ev(`(async()=>{const t=await import('/src/formats/textDrop.ts');const b=await import('/src/model/board.svelte.ts');const text=Array.from({length:30},(_,i)=>'Line '+(i+1)+' of the markdown file').join('\\n');const ids=t.createMarkdownNotes([{path:'C:/docs/Readme.md',text}],{x:-60,y:-20});const n=b.board.notes[ids[0]];return n.type+' name='+n.name+' height='+n.height+' width='+n.width})()`));
// 9: locked Source
console.log("9 source:", await ev(`(async()=>{const s=await import('/src/source/creation.ts');const b=await import('/src/model/board.svelte.ts');const ids=s.createLockedSourceNotes(['C:/Tools/setup.exe'],{x:0,y:-25});const n=b.board.notes[ids[0]];await new Promise(r=>setTimeout(r,500));const a=document.querySelector('[data-note-id="'+ids[0]+'"]');return n.type+' locked='+n.source?.locked+' path='+JSON.stringify(n.source)+' | choose button: '+!!a?.querySelector('[data-source-choose-file]')+' | open: '+!!a?.querySelector('[data-source-open]')})()`));
// 7: header name not selectable
console.log("7 header user-select:", await ev(`getComputedStyle(document.querySelector('.note-header')).userSelect`));
// video
await ev(`(async()=>{const v=await import('/src/video/import.ts');await v.importVideoFiles([await __webm()],{x:45,y:-15})})()`); await wait(1500);
const vn = await pos(`document.querySelector('[data-video-node]')`);
await click(vn, "right"); await wait(250);
console.log("5 video menu:", await menu());
const hide = await pos(`[...document.querySelectorAll('[role=menu] button,[role=menuitem]')].find(b=>b.offsetWidth&&/frame/i.test(b.innerText))`);
if (hide) { await click(hide); console.log("5 frameHidden:", await ev(`(async()=>{const b=await import('/src/model/board.svelte.ts');return b.board.order.map(i=>b.board.notes[i]).find(n=>n.type==='video').frameHidden})()`)); }
const vol = await pos(`document.querySelector('[data-video-volume] button, [data-video-volume]')`);
if (vol) { await mouse("mouseMoved", vol.x, vol.y); await wait(400); console.log("6 volume button", Math.round(vol.w) + "x" + Math.round(vol.h), "| popover:", await ev(`(()=>{const p=document.querySelector('[data-volume-open] [role=slider], [data-video-volume] [aria-orientation=vertical]');const box=p?.closest('[class*=popover],[class*=volume]');if(!p)return 'none';const r=(box||p).getBoundingClientRect();const btn=document.querySelector('[data-video-volume] button');return Math.round(r.width)+'x'+Math.round(r.height)+' bg '+getComputedStyle(box||p).backgroundColor+' | button bg '+(btn?getComputedStyle(btn).backgroundColor:'-')})()`)); }
await shot("d20-video");
// 8: tierlist with video/audio/youtube targets
console.log("8:", await ev(`(async()=>{const b=await import('/src/model/board.svelte.ts');const c=await import('/src/notes/noteCommands.ts');const l=await import('/src/youtube/logic.ts');const ya=await import('/src/youtube/actions.svelte.ts');const yid=ya.createYouTubeNote(l.parseYouTubeUrl('https://youtu.be/dQw4w9WgXcQ').ref,{x:60,y:60});const vid=b.board.order.find(i=>b.board.notes[i].type==='video');const t=c.createNoteKind('tierlist');const n=b.board.notes[t];n.x=-70;n.y=30;n.tiers=[{id:'r1',name:'S',color:'#FF4B5C',cards:[{id:'cv',kind:'note',noteId:vid},{id:'cy',kind:'note',noteId:yid}]}];window.__tier=t;return 'ok'})()`));
await wait(2500);
console.log("8 cards:", await ev(`[...document.querySelectorAll('[data-note-id="'+window.__tier+'"] [data-tier-card-id]')].map(c=>c.dataset.tierCardId+':'+(c.querySelector('canvas')?'frame-canvas':c.querySelector('img')?'img':c.querySelector('button')?'button':'text')+' "'+c.innerText.replace(/\\s+/g,' ').trim().slice(0,40)+'"').join(' ; ')`));
await ev(`(async()=>{const c=await import('/src/board/camera.svelte.ts');c.camera.x=-30;c.camera.y=40})()`); await wait(500);
await shot("d20-tier");
console.log("errors:", errors.length ? errors.join(" || ") : "none");
ws.close();
