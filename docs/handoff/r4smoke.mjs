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
  const l = await import('/src/model/links.svelte.ts');
  const z = await import('/src/model/zones.svelte.ts');
  const zm = await import('/src/model/zone.ts');
  const c = await import('/src/board/camera.svelte.ts');
  const f = await import('/src/beacons/beaconState.svelte.ts');
  const now = Date.now();
  z.addZone({ id: 'z1', name: 'Work', color: '#3d7ab8', parts: [zm.rectContour(-45, -25, 60, 45)], holes: [] });
  z.addZone({ id: 'z2', name: 'Home', color: '#4f9d5d', parts: [zm.rectContour(15, -25, 45, 45)], holes: [] });
  b.addNote({ id: 'bc', type: 'beacon', name: 'Project', text: '', x: -40, y: -20, width: 7.2, height: 7.2, color: '#c85a5a', createdAt: now });
  b.addNote({ id: 'n1', type: 'note', name: 'Plan', text: 'first', x: -25, y: -18, width: 30, height: null, createdAt: now + 1 });
  b.addNote({ id: 'n2', type: 'note', name: 'Draft', text: 'second', x: -25, y: 2, width: 30, height: null, createdAt: now + 2 });
  b.addNote({ id: 'n3', type: 'note', name: 'Groceries', text: 'milk', x: 22, y: -10, width: 30, height: null, createdAt: now + 3 });
  b.addNote({ id: 'n4', type: 'note', name: 'Outside', text: 'far', x: 70, y: 5, width: 30, height: null, createdAt: now + 4 });
  l.addLink({ id: 'l1', from: 'bc', to: 'n1', kind: 'strong', shape: 'base' });
  l.addLink({ id: 'l2', from: 'n1', to: 'n2', kind: 'strong', shape: 'base' });
  l.addLink({ id: 'l3', from: 'n3', to: 'n4', kind: 'weak', shape: 'base' });
  f.beaconState.focused = ['bc'];
  f.beaconState.marked = ['bc'];
  c.camera.x = 15; c.camera.y = 0; c.camera.zoom = 1.05;
  return 'ok';
})()`;
const r = await send("Runtime.evaluate", { expression: setup, awaitPromise: true, returnByValue: true });
console.log(JSON.stringify(r.result?.result?.value ?? r.result?.exceptionDetails));
await new Promise((res) => setTimeout(res, 1000));
const shot = await send("Page.captureScreenshot", { format: "png" });
writeFileSync(out, Buffer.from(shot.result.data, "base64"));
ws.close();
