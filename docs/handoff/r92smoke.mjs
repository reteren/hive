// R9 delivery 2 smoke: PDF node, Format edit+Ctrl+S+undo, audio node, local video (seek), YouTube node + play.
import { writeFileSync } from "node:fs";
const page = (await fetch(`http://localhost:9334/json/list`).then((r) => r.json())).find((t) => t.type === "page");
const ws = new WebSocket(page.webSocketDebuggerUrl); let id = 0; const pending = new Map(); const errors = [];
ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.method === "Runtime.exceptionThrown") errors.push(m.params.exceptionDetails.exception?.description?.slice(0, 200)); if (pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } };
await new Promise((r) => (ws.onopen = r));
const send = (method, params = {}) => new Promise((r) => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
await send("Runtime.enable");
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const ev = async (expression) => { const r = await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true }); return r.result?.result?.value ?? r.result?.exceptionDetails?.exception?.description; };
const mouse = (type, x, y, button = "none", buttons = 0, clickCount = 1) => send("Input.dispatchMouseEvent", { type, x, y, button, buttons, clickCount: type === "mouseMoved" ? 0 : clickCount });
const pos = (expr) => ev(`(()=>{const e=${expr};if(!e)return null;e.scrollIntoView?.({block:'nearest'});const r=e.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}})()`);
const click = async (p, count = 1) => { await mouse("mouseMoved", p.x, p.y); for (let c = 1; c <= count; c++) { await mouse("mousePressed", p.x, p.y, "left", 1, c); await mouse("mouseReleased", p.x, p.y, "left", 0, c); } await wait(350); };
const key = async (k, code, vk, modifiers = 0, text) => { await send("Input.dispatchKeyEvent", { type: "keyDown", key: k, code, windowsVirtualKeyCode: vk, modifiers, text }); await send("Input.dispatchKeyEvent", { type: "keyUp", key: k, code, windowsVirtualKeyCode: vk, modifiers }); await wait(150); };
const shot = async (n) => writeFileSync(`C:/Users/reteren/AppData/Local/Temp/claude/${n}.png`, Buffer.from((await send("Page.captureScreenshot", { format: "png" })).result.data, "base64"));
const model = (expr) => ev(`(async()=>{const b=await import('/src/model/board.svelte.ts');const n=b.board.notes;const of=(t)=>b.board.order.map(i=>n[i]).filter(x=>x.type===t);return ${expr}})()`);

await ev(`(async()=>{const b=await import('/src/model/board.svelte.ts');const cam=await import('/src/board/camera.svelte.ts');const h=await import('/src/history/history.svelte.ts');for(const i of [...b.board.order])b.removeNote(i);h.clear();cam.camera.x=0;cam.camera.y=0;cam.camera.zoom=0.6;
 window.__pdf=()=>{const s='%PDF-1.4\\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj 2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj 3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 200 200]>>endobj\\ntrailer<</Root 1 0 R>>\\n%%EOF';return new File([s],'doc.pdf',{type:'application/pdf'})};
 window.__wav=()=>{const sr=8000,n=sr;const buf=new ArrayBuffer(44+n*2);const v=new DataView(buf);const w=(o,s)=>[...s].forEach((c,i)=>v.setUint8(o+i,c.charCodeAt(0)));w(0,'RIFF');v.setUint32(4,36+n*2,true);w(8,'WAVE');w(12,'fmt ');v.setUint32(16,16,true);v.setUint16(20,1,true);v.setUint16(22,1,true);v.setUint32(24,sr,true);v.setUint32(28,sr*2,true);v.setUint16(32,2,true);v.setUint16(34,16,true);w(36,'data');v.setUint32(40,n*2,true);for(let i=0;i<n;i++)v.setInt16(44+i*2,Math.sin(i/5)*8000,true);return new File([buf],'tone.wav',{type:'audio/wav'})};
 window.__webm=async()=>{const cv=document.createElement('canvas');cv.width=320;cv.height=180;const x=cv.getContext('2d');const st=cv.captureStream(15);const rec=new MediaRecorder(st,{mimeType:'video/webm'});const parts=[];rec.ondataavailable=e=>parts.push(e.data);rec.start();let f=0;const t=setInterval(()=>{x.fillStyle='hsl('+(f*20)+',60%,40%)';x.fillRect(0,0,320,180);f++},66);await new Promise(r=>setTimeout(r,2200));clearInterval(t);rec.stop();await new Promise(r=>rec.onstop=r);return new File([new Blob(parts,{type:'video/webm'})],'clip.webm',{type:'video/webm'})};
 return 'setup'})()`);
// PDF + Format
console.log("pdf/format:", await ev(`(async()=>{const s=await import('/src/attachments/service.ts');const c=await import('/src/formats/formatCreation.ts');const p=await s.importMediaFile(__pdf());const t=await s.importMediaFile(new File(['print(\\"hi\\")\\n'],'script.py',{type:'text/x-python'}));if(!p.ok||!t.ok)return 'import failed: '+(p.error||t.error);c.createFormatNotes([p.media],{x:-45,y:-15});c.createFormatNotes([t.media],{x:20,y:-15});return 'ok '+p.media.kind+' '+t.media.kind})()`));
await wait(1200);
console.log("1 pdf frame:", await ev(`(()=>{const a=[...document.querySelectorAll('article[data-kind=pdf]')][0];if(!a)return 'no pdf node';const f=a.querySelector('iframe,embed,object');return f?f.tagName+' src='+(f.src||f.data||'').slice(0,30):'no frame: '+a.innerText.slice(0,80)})()`));
console.log("2 format header:", await ev(`(()=>{const a=document.querySelector('article[data-kind=format]');return a?a.innerText.replace(/\\s+/g,' ').slice(0,120):'none'})()`));
console.log("2 run button present:", await ev(`!!document.querySelector('article[data-kind=format] button[title*=Run i],article[data-kind=format] [data-run]')`));
const ed = await pos(`document.querySelector('article[data-kind=format] .cm-content')`);
const fileBefore = await model(`of('format')[0].media.file`);
if (ed) { await click(ed); await key("End", "End", 35, 2); for (const ch of "# edit") await key(ch, "", ch.charCodeAt(0), 0, ch); await wait(200); }
console.log("2 dirty marker:", await ev(`document.querySelector('article[data-kind=format]').innerText.includes('●')||!!document.querySelector('article[data-kind=format] [data-unsaved],article[data-kind=format] .unsaved')`));
await key("s", "KeyS", 83, 2); await wait(800);
const fileAfter = await model(`of('format')[0].media.file`);
console.log("2 Ctrl+S new file:", fileBefore !== fileAfter, "| text now:", await ev(`(async()=>{const s=await import('/src/attachments/service.ts');const u=s.attachmentUrl('${fileAfter}');return u?(await (await fetch(u)).text()).replace(/\\n/g,'⏎'):'no url'})()`));
await click({ x: 1200, y: 760 }); await key("z", "KeyZ", 90, 2); await wait(400);
console.log("2 after Ctrl+Z file restored:", (await model(`of('format')[0].media.file`)) === fileBefore);
await shot("r92-format");
// Audio
console.log("audio:", await ev(`(async()=>{const a=await import('/src/audio/audioActions.ts');return await a.importAudioFileFromBrowser(__wav(),{x:-45,y:30})})()`)); await wait(1200);
console.log("3 audio:", await ev(`(()=>{const a=document.querySelector('[data-audio-node]');if(!a)return 'none';const el=a.querySelector('audio');return 'audio el '+!!el+' duration '+(el?el.duration.toFixed(2):'-')+' | '+a.innerText.replace(/\\s+/g,' ').slice(0,80)})()`));
// Video
console.log("video:", await ev(`(async()=>{const v=await import('/src/video/import.ts');const ids=await v.importVideoFiles([await __webm()],{x:20,y:35});return ids.length})()`)); await wait(1500);
console.log("4 video:", await ev(`(async()=>{const v=document.querySelector('[data-video-node] video');if(!v)return 'none: '+(document.querySelector('[data-video-node]')?.innerText??'no node');await new Promise(r=>v.readyState>=1?r():v.onloadedmetadata=r);v.currentTime=0.8;await new Promise(r=>setTimeout(r,500));return 'ready '+v.readyState+' seek -> '+v.currentTime.toFixed(2)+' autoplay '+(!v.paused)+' caption '+!!document.querySelector('[data-video-caption]')})()`));
// YouTube
console.log("yt:", await ev(`(async()=>{const l=await import('/src/youtube/logic.ts');const a=await import('/src/youtube/actions.svelte.ts');const r=l.parseYouTubeUrl('https://youtu.be/dQw4w9WgXcQ?t=1m30s');if(r.kind!=='youtube')return 'parse '+r.kind;a.createYouTubeNote(r.ref,{x:85,y:10});return 'start='+r.ref.start})()`)); await wait(2500);
console.log("5 youtube:", await ev(`(()=>{const n=document.querySelector('[data-youtube-node]');if(!n)return 'none';const t=n.querySelector('[data-youtube-thumbnail]');const img=t?.tagName==='IMG'?t:t?.querySelector('img');return 'thumb '+!!t+' loaded '+(img?img.naturalWidth>0:'-')+' | '+n.innerText.replace(/\\s+/g,' ').slice(0,90)})()`));
const play = await pos(`document.querySelector('[data-youtube-node] button')`);
if (play) { await click(play); await wait(1500); }
console.log("5 after play:", await ev(`(()=>{const f=document.querySelector('[data-youtube-embed] iframe,iframe[data-youtube-embed]');return f?'iframe '+f.src.slice(0,70):'no iframe; '+(document.querySelector('[data-youtube-error]')?.innerText??'')})()`));
await ev(`(async()=>{const cam=await import('/src/board/camera.svelte.ts');cam.camera.x=10;cam.camera.y=10;cam.camera.zoom=0.55})()`); await wait(500);
await shot("r92-all");
console.log("6 serialize round-trip kinds:", await ev(`(async()=>{const p=await import('/src/project/index.ts');const b=await import('/src/model/board.svelte.ts');const fn=Object.keys(p).filter(k=>/serial|toIndex|build/i.test(k)).join(',');return fn})()`));
console.log("errors:", errors.length ? errors.join(" || ") : "none");
ws.close();
