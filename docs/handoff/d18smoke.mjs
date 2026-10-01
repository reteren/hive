// Debug 18 smoke (after 1.4.2): dictaphone (record by button, 2 recordings, rename/delete/undo), audio player row, video custom controls + Space, PDF crispness sizing, Importance chip.
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
const pos = (expr) => ev(`(()=>{const e=${expr};if(!e)return null;const r=e.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}})()`);
const click = async (p) => { await mouse("mouseMoved", p.x, p.y); await mouse("mousePressed", p.x, p.y, "left", 1); await mouse("mouseReleased", p.x, p.y, "left", 0); await wait(300); };
const key = async (k, code, vk, modifiers = 0, text) => { await send("Input.dispatchKeyEvent", { type: "keyDown", key: k, code, windowsVirtualKeyCode: vk, modifiers, text }); await send("Input.dispatchKeyEvent", { type: "keyUp", key: k, code, windowsVirtualKeyCode: vk, modifiers }); await wait(250); };
const shot = async (n) => writeFileSync(`C:/Users/reteren/AppData/Local/Temp/claude/${n}.png`, Buffer.from((await send("Page.captureScreenshot", { format: "png" })).result.data, "base64"));
const recs = () => ev(`(async()=>{const b=await import('/src/model/board.svelte.ts');const n=b.board.order.map(i=>b.board.notes[i]).find(x=>x.type==='audio'&&x.recordings!==undefined||x.type==='audio'&&!x.media);return n?JSON.stringify((n.recordings??[]).map(r=>r.name)):'no dictaphone'})()`);

await ev(`(async()=>{const b=await import('/src/model/board.svelte.ts');const cam=await import('/src/board/camera.svelte.ts');const h=await import('/src/history/history.svelte.ts');for(const i of [...b.board.order])b.removeNote(i);h.clear();cam.camera.x=0;cam.camera.y=0;cam.camera.zoom=1;
 window.__wav=()=>{const sr=8000,n=sr*2;const buf=new ArrayBuffer(44+n*2);const v=new DataView(buf);const w=(o,s)=>[...s].forEach((c,i)=>v.setUint8(o+i,c.charCodeAt(0)));w(0,'RIFF');v.setUint32(4,36+n*2,true);w(8,'WAVE');w(12,'fmt ');v.setUint32(16,16,true);v.setUint16(20,1,true);v.setUint16(22,1,true);v.setUint32(24,sr,true);v.setUint32(28,sr*2,true);v.setUint16(32,2,true);v.setUint16(34,16,true);w(36,'data');v.setUint32(40,n*2,true);for(let i=0;i<n;i++)v.setInt16(44+i*2,Math.sin(i/5)*8000,true);return new File([buf],'tone.wav',{type:'audio/wav'})};
 window.__webm=async()=>{const cv=document.createElement('canvas');cv.width=320;cv.height=180;const x=cv.getContext('2d');const st=cv.captureStream(15);const rec=new MediaRecorder(st,{mimeType:'video/webm'});const parts=[];rec.ondataavailable=e=>parts.push(e.data);rec.start();let f=0;const t=setInterval(()=>{x.fillStyle='hsl('+(f*20)+',60%,40%)';x.fillRect(0,0,320,180);f++},66);await new Promise(r=>setTimeout(r,2500));clearInterval(t);rec.stop();await new Promise(r=>rec.onstop=r);return new File([new Blob(parts,{type:'video/webm'})],'clip.webm',{type:'video/webm'})};
 const r=await import('/src/audio/recording.svelte.ts');window.__dict=r.createDictaphoneNote({x:-40,y:-15});return 'ok'})()`);
await wait(800);
console.log("5 dictaphone initial state:", await ev(`document.querySelector('[data-audio-recording]')?.innerText.replace(/\\s+/g,' ').slice(0,80) ?? document.querySelector('[data-audio-node]')?.innerText.replace(/\\s+/g,' ').slice(0,80)`), "| recordings:", await recs());
const recBtn = `[...document.querySelectorAll('[data-audio-node] button')].find(b=>/record|stop/i.test((b.getAttribute('aria-label')||'')+b.textContent))`;
for (let k = 0; k < 2; k++) {
  await click(await pos(recBtn)); await wait(1600);
  console.log(`5 while recording #${k + 1}:`, await ev(`document.querySelector('[data-audio-node]').innerText.replace(/\\s+/g,' ').slice(0,60)`));
  await click(await pos(recBtn)); await wait(1500);
}
console.log("5 after two takes:", await recs(), "| rows:", await ev(`document.querySelectorAll('[data-audio-player-row]').length`));
await shot("d18-dictaphone");
// delete one, undo
const del = await pos(`[...document.querySelectorAll('[data-audio-player-row] button')].find(b=>/delete/i.test(b.getAttribute('aria-label')||b.title||''))`);
if (del) { await click(del); console.log("5 after delete:", await recs()); await click({ x: 1200, y: 760 }); await key("z", "KeyZ", 90, 2); await wait(300); console.log("5 after Ctrl+Z:", await recs()); }
// audio file + video
await ev(`(async()=>{const a=await import('/src/audio/audioActions.ts');await a.importAudioFileFromBrowser(__wav(),{x:30,y:-25});const v=await import('/src/video/import.ts');await v.importVideoFiles([await __webm()],{x:30,y:15})})()`); await wait(2000);
await shot("d18-players");
const vp = await pos(`document.querySelector('[data-video-player]')`);
await mouse("mouseMoved", vp.x, vp.y); await wait(200);
const camBefore = await ev(`(async()=>{const c=await import('/src/board/camera.svelte.ts');return c.camera.x.toFixed(1)+','+c.camera.y.toFixed(1)})()`);
await key(" ", "Space", 32, 0, " "); await wait(500);
console.log("3 Space over video -> paused:", await ev(`document.querySelector('[data-video-node] video').paused`), "| camera", camBefore, "->", await ev(`(async()=>{const c=await import('/src/board/camera.svelte.ts');return c.camera.x.toFixed(1)+','+c.camera.y.toFixed(1)})()`));
await key(" ", "Space", 32, 0, " "); await wait(300);
console.log("3 second Space -> paused:", await ev(`document.querySelector('[data-video-node] video').paused`));
console.log("R3 native controls attr:", await ev(`document.querySelector('[data-video-node] video').controls`), "| custom controls:", !!(await ev(`!!document.querySelector('[data-video-controls]')`)));
await mouse("mouseMoved", vp.x + 5, vp.y + 5); await wait(150);
const vis = () => ev(`(()=>{const c=document.querySelector('[data-video-controls]');return c?getComputedStyle(c).opacity:'none'})()`);
console.log("R3 controls opacity moving:", await vis()); await wait(1300); console.log("R3 controls opacity after 1.3s still:", await vis());
await shot("d18-video");
console.log("errors:", errors.length ? errors.join(" || ") : "none");
ws.close();
