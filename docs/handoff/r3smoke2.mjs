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
  const c = await import('/src/board/camera.svelte.ts');
  const t = await import('/src/tasks/tasksPanelState.svelte.ts');
  const now = Date.now();
  b.addNote({ id: 'a', type: 'note', name: 'Buy laptop', text: 'Compare **three** models', x: -40, y: -15, width: 30, height: null, createdAt: now, importance: 'important', purposes: ['decision', 'compare'], moods: ['joy', 'curiosity', 'anger'] });
  b.addNote({ id: 'md', type: 'mood', name: 'Mood', text: '', x: 40, y: -30, width: 14, height: 4, createdAt: now + 7, moods: ['sadness'] });
  b.addNote({ id: 't1', type: 'note', name: 'Pick model', text: 'research', x: 0, y: -15, width: 30, height: null, createdAt: now + 1, task: { done: false, doneAt: null } });
  b.addNote({ id: 't2', type: 'note', name: 'Order it', text: '', x: 0, y: 5, width: 30, height: null, createdAt: now + 2, task: { done: false, doneAt: null }, importance: 'absolute' });
  b.addNote({ id: 'p', type: 'pro', name: 'Plus', text: 'Lighter', x: -40, y: 5, width: 18, height: null, createdAt: now + 3 });
  b.addNote({ id: 'm', type: 'con', name: 'Minus', text: 'Pricey', x: -20, y: 5, width: 18, height: null, createdAt: now + 4 });
  b.addNote({ id: 'imp', type: 'importance', name: 'Importance', text: '', x: 40, y: -15, width: 14, height: 4, createdAt: now + 5, importance: 'immediately' });
  b.addNote({ id: 'done', type: 'note', name: 'Old task', text: 'finished', x: 40, y: 5, width: 30, height: null, createdAt: now + 6, task: { done: true, doneAt: now } });
  l.addLink({ id: 'l1', from: 't1', to: 't2', kind: 'strong', shape: 'base' });
  l.addLink({ id: 'l2', from: 'a', to: 'p', kind: 'strong', shape: 'base' });
  l.addLink({ id: 'l3', from: 'a', to: 'm', kind: 'strong', shape: 'base' });
  l.addLink({ id: 'l4', from: 'imp', to: 't1', kind: 'strong', shape: 'base' });
  c.camera.x = 5; c.camera.y = -2; c.camera.zoom = 1.3;
  if (t.toggleTasksPanel) t.toggleTasksPanel();
  return 'ok';
})()`;
const r = await send("Runtime.evaluate", { expression: setup, awaitPromise: true, returnByValue: true });
console.log(JSON.stringify(r.result?.result?.value ?? r.result?.exceptionDetails));
await new Promise((res) => setTimeout(res, 1000));
const shot = await send("Page.captureScreenshot", { format: "png" });
writeFileSync(out, Buffer.from(shot.result.data, "base64"));
ws.close();
