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
  const calc = await import('/src/calculator/calculators.svelte.ts');
  const c = await import('/src/board/camera.svelte.ts');
  const now = Date.now();
  const done = { done: true, completedAt: now };
  const open = { done: false, completedAt: null };
  b.addNote({ id: 't1', type: 'note', name: 'Buy paint', text: 'white', x: -95, y: -45, width: 30, height: null, createdAt: now, task: done, importance: 'important' });
  b.addNote({ id: 't2', type: 'note', name: 'Paint wall', text: 'two layers', x: -95, y: -15, width: 30, height: null, createdAt: now + 1, task: done });
  b.addNote({ id: 'g', type: 'goal', name: 'Room ready', text: '', x: -50, y: -30, width: 30, height: null, createdAt: now + 2 });
  l.addLink({ id: 'l1', from: 't1', to: 'g', kind: 'strong', shape: 'base' });
  l.addLink({ id: 'l2', from: 't2', to: 'g', kind: 'strong', shape: 'base' });
  b.addNote({ id: 't3', type: 'note', name: 'Clean up', text: 'floor', x: -95, y: 15, width: 30, height: null, createdAt: now + 3, task: open });
  b.addNote({ id: 'p', type: 'progress', name: 'Progress', text: '', x: -50, y: 5, width: 30, height: null, createdAt: now + 4, scope: { kind: 'board' } });
  b.addNote({ id: 's', type: 'stats', name: 'Statistics', text: '', x: -50, y: 30, width: 30, height: null, createdAt: now + 5, scope: { kind: 'board' } });
  calc.setCalculatorData('Budget', { entries: [{ id: 'e1', expression: '12*3+4' }, { id: 'e2', expression: '(1+' }], bank: { name: 'Trip', initial: 100 }, rows: [{ id: 'r1', label: 'Buy paint', amount: 30, sourceNoteId: 't1' }] });
  b.addNote({ id: 'c', type: 'calculator', name: 'Budget', text: '', x: -15, y: -45, width: 40, height: null, createdAt: now + 6 });
  b.addNote({ id: 'tl', type: 'tierlist', name: 'Tierlist', text: '', x: 30, y: -45, width: 60, height: null, createdAt: now + 7,
    tiers: [
      { id: 'S', name: 'S', color: '#b85450', cards: [{ id: 'k1', kind: 'note', noteId: 't2' }, { id: 'k2', kind: 'text', text: 'Blue' }] },
      { id: 'A', name: 'A', color: '#c7843b', cards: [{ id: 'k3', kind: 'note', noteId: 'gone' }] },
      { id: 'B', name: 'B', color: '#c8b04a', cards: [] } ] });
  c.camera.x = 0; c.camera.y = 0; c.camera.zoom = 0.75;
  return 'ok';
})()`;
const r = await send("Runtime.evaluate", { expression: setup, awaitPromise: true, returnByValue: true });
console.log(JSON.stringify(r.result?.result?.value ?? r.result?.exceptionDetails));
await new Promise((res) => setTimeout(res, 1000));
const shot = await send("Page.captureScreenshot", { format: "png" });
writeFileSync(out, Buffer.from(shot.result.data, "base64"));
ws.close();
