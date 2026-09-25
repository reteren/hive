// R3 visual smoke: tasks, dependency, modules, plus/minus.
import { writeFileSync } from "node:fs";

const port = 9334;
const out = process.argv[2];
const page = (await fetch(`http://localhost:${port}/json/list`).then((r) => r.json())).find((t) => t.type === "page");
const ws = new WebSocket(page.webSocketDebuggerUrl);
let id = 0;
const pending = new Map();
ws.onmessage = (e) => { const m = JSON.parse(e.data); if (pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } };
await new Promise((r) => (ws.onopen = r));
const send = (method, params = {}) => new Promise((r) => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });

const setup = `(async () => {
  const b = await import('/src/model/board.svelte.ts');
  const z = await import('/src/model/zones.svelte.ts');
  const zm = await import('/src/model/zone.ts');
  const c = await import('/src/board/camera.svelte.ts');
  const now = Date.now();
  b.addNote({ id: 'n1', type: 'note', name: 'Lines', text: 'first' + String.fromCharCode(10) + 'second row', x: -40, y: -20, width: 14, height: null, createdAt: now + 1 });
  b.addNote({ id: 'n2', type: 'note', name: 'Long', text: 'a long line of text that should not wrap until max width is reached ok', x: -40, y: 0, width: 14, height: null, createdAt: now + 2 });
  b.addNote({ id: 'm1', type: 'mood', name: 'Mood 1', text: '', x: 20, y: -20, width: 14, height: null, createdAt: now + 3, moods: ['sadness'] });
  z.addZone({ id: 'z1', name: 'Z', color: '#3d7ab8', parts: [zm.rectContour(20, 5, 30, 30)], holes: [] });
  c.camera.x = 0; c.camera.y = 0; c.camera.zoom = 1.4;
  return 'ok';
})()`;
const r = await send("Runtime.evaluate", { expression: setup, awaitPromise: true, returnByValue: true });
console.log(JSON.stringify(r.result?.result?.value ?? r.result?.exceptionDetails));
await new Promise((res) => setTimeout(res, 1000));
const shot = await send("Page.captureScreenshot", { format: "png" });
writeFileSync(out, Buffer.from(shot.result.data, "base64"));
ws.close();
