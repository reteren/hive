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

const setup = (snap) => `(async () => {
  const b = await import('/src/model/board.svelte.ts');
  const s = await import('/src/selection/selection.svelte.ts');
  const c = await import('/src/board/camera.svelte.ts');
  const now = Date.now();
  b.addNote({ id: 'n1', type: 'note', name: 'Plan', text: 'first line', x: -35, y: -15, width: 30, height: null, createdAt: now + 1, widthLocked: true });
  b.addNote({ id: 'n2', type: 'note', name: 'Draft', text: 'second', x: 5, y: -15, width: 30, height: null, createdAt: now + 2 });
  b.addNote({ id: 'm1', type: 'mood', name: 'Mood 1', text: '', x: -35, y: 10, width: 14, height: null, createdAt: now + 3, moods: [] });
  const g = await import('/src/board/grid.svelte.ts'); g.grid.snap = ${snap};
  s.selection.ids = ['n2']; s.selection.primaryId = 'n2';
  c.camera.x = 0; c.camera.y = 0; c.camera.zoom = 1.3;
  return 'ok';
})()`;
for (const snap of [false, true]) {
const r = await send("Runtime.evaluate", { expression: setup(snap), awaitPromise: true, returnByValue: true });
console.log(JSON.stringify(r.result?.result?.value ?? r.result?.exceptionDetails));
await new Promise((res) => setTimeout(res, 1000));
const shot = await send("Page.captureScreenshot", { format: "png", clip: { x: 500, y: 0, width: 300, height: 60, scale: 3 } });
writeFileSync(out.replace(".png", `-${snap}.png`), Buffer.from(shot.result.data, "base64"));
}
ws.close();
