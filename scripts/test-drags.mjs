// The drag matrix (D224): an object dragged in the preview lands where the pointer is, whatever
// animation is placed on it, and the numbers written stay sane. Nineteen drags: a bare
// declaration; a move before, during, and after; an absolute path at its start, during, and
// after; a relative function path; a ranged relative slide before it, at its start, during, and
// after; a turn and a fade running; a move over a path; a Shift drag after a path; a bounce
// preset during and after.
//
// Start the app with a debugging port, then run this; it opens a temporary copy of
// examples/first, so the playground is never touched:
//   npx electron-vite dev -- --remote-debugging-port=9222
//   node scripts/test-drags.mjs
import { cpSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const example = fileURLToPath(new URL('../examples/first', import.meta.url))
const copy = join(mkdtempSync(join(tmpdir(), 'quick-animator-drags-')), 'first')
cpSync(example, copy, { recursive: true })
const PROJECT = copy.replace(/\\/g, '/')

const targets = await (await fetch('http://127.0.0.1:9222/json')).json()
const page = targets.find((t) => t.type === 'page')
if (!page) throw new Error('No app page on port 9222: start the app with --remote-debugging-port=9222')
const ws = new WebSocket(page.webSocketDebuggerUrl)
let nextId = 0
const pending = new Map()
const send = (method, params = {}) =>
  new Promise((resolve, reject) => {
    const id = ++nextId
    pending.set(id, { resolve, reject })
    ws.send(JSON.stringify({ id, method, params }))
  })
await new Promise((r) => ws.addEventListener('open', r))
ws.addEventListener('message', (ev) => {
  const m = JSON.parse(String(ev.data))
  const p = pending.get(m.id)
  if (!p) return
  pending.delete(m.id)
  m.error ? p.reject(new Error(JSON.stringify(m.error))) : p.resolve(m.result)
})

/** Run a scenario inside the page, with the helpers the scenario uses. */
const run = async (body) => {
  const expression = `(async () => {
const smp = await import('/src/model/sample.ts');
const pre = await import('/src/project/presets.ts');
const S = () => window.__quickAnimator.useStore.getState();
const tick = (ms = 60) => new Promise(r => setTimeout(r, ms));
const pe = (el, type, x, y, extra = {}) => el.dispatchEvent(new PointerEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y, button: 0, buttons: type === 'pointerup' ? 0 : 1, pointerId: 1, isPrimary: true, pointerType: 'mouse', ...extra }));
const obj = (name) => S().model.objects.find(o => o.name === name);
const setSource = async (text) => { const ed = window.__quickAnimator.getEditor(); ed.dispatch({ changes: { from: 0, to: ed.state.doc.length, insert: text } }); await tick(400) };
const geom = () => { const el = document.querySelector('.preview'); const r = el.getBoundingClientRect(); const zoom = Math.max(Math.min((r.width - 80) / 1920, (r.height - 80) / 1080), 0.02); const sx = (wx) => r.left + r.width / 2 + wx * zoom; const sy = (wy) => r.top + r.height / 2 - wy * zoom; return { el, r, zoom, sx, sy } };
const drag = async (g, points, extra = {}) => { const [first, ...rest] = points; pe(g.el, 'pointerdown', g.sx(first.x), g.sy(first.y), extra); pe(g.el, 'pointermove', g.sx(first.x) + 4, g.sy(first.y), extra); let prev = first; for (const p of rest) { const n = Math.max(1, Math.ceil(Math.hypot(p.x - prev.x, p.y - prev.y) / 15)); for (let i = 1; i <= n; i++) pe(g.el, 'pointermove', g.sx(prev.x + (p.x - prev.x) * i / n), g.sy(prev.y + (p.y - prev.y) * i / n), extra); prev = p } pe(g.el, 'pointerup', g.sx(prev.x), g.sy(prev.y), extra); await tick(150) };
${body} })()`
  const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true, timeout: 300000 })
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text)
  return r.result.value
}

const MATRIX = `
await window.__quickAnimator.openProject('${PROJECT}'); await tick(800);
const r = window.__quickAnimator.getRenderer();
S().setTool('select'); S().setTransformMode('move'); if (S().collide) S().setCollide(false); S().setPreviewSnap({ on: false, edges: false });
const nl = String.fromCharCode(10);
const decl = ['b = Rect({', '  x: -300,', '  y: 0,', '  width: 100,', '  height: 60,', '})', '', 'c = Circle({', '  x: 500,', '  y: -400,', '  radius: 20,', '})', ''].join(nl);
const scene = (...acts) => decl + acts.map(a => nl + a + nl).join('');
const move = 'b.move({ x: 0, at: 1, duration: 1 })';
const pathAbs = 'b.path({ shape: [[-300, 0], [0, 200]], at: 0, duration: 2 })';
const orbit = 'b.path({ shape: (p) => [Math.cos(p * 2 * Math.PI) * 100, Math.sin(p * 2 * Math.PI) * 100], relative: true, at: 0, duration: 2 })';
const slide = 'b.move({ x: [-400, 0], relative: true, at: 0, duration: 0.6, easeIn: 0 })';
const slideLater = 'b.move({ x: [-400, 0], relative: true, at: 1, duration: 0.6, easeIn: 0 })';
const turn = 'b.rotate({ rotation: 90, at: 0, duration: 1 })';
const fade = 'b.fade({ opacity: [0, 1], at: 0, duration: 0.5 })';
// Every number in the file stays within reason: nothing written is garbage.
const sane = () => { const nums = S().source.split(/[^0-9.-]+/).map(Number).filter(Number.isFinite).map(Math.abs); return Math.max(0, ...nums) < 5000 };
const out = [];
const one = async (label, src, time, tx, ty, extra) => {
  await setSource(src); S().select([]); S().setTime(time); await tick(150);
  const g = geom(); const f0 = r.frameOf('b');
  await drag(g, [{ x: f0.x, y: f0.y }, { x: tx, y: ty }], extra ?? {}); await tick(150);
  const last = obj('b').actions.slice(-1)[0];
  // A Shift drag makes an animation and the playhead comes back: the object shows the drag at that animation's end.
  const at = extra?.shiftKey && last ? last.end : S().time;
  const p = smp.positionAt(S().model, obj('b'), at);
  out.push({ label, target: [tx, ty], shown: [Math.round(p.x), Math.round(p.y)], time: S().time, ok: Math.abs(p.x - tx) <= 2 && Math.abs(p.y - ty) <= 2, sane: sane(), err: S().error?.message ?? null });
};
await one('declaration only', scene(), 0, -100, 50);
await one('move, before it', scene(move), 0, -100, 50);
await one('move, during it', scene(move), 1.5, 100, 50);
await one('move, after it', scene(move), 3, 100, 50);
await one('path, at its start', scene(pathAbs), 0, -200, 50);
await one('path, during it', scene(pathAbs), 1, 100, 250);
await one('path, after it', scene(pathAbs), 3, 100, 250);
await one('relative function path, at its start', scene(orbit), 0, 0, 100);
await one('relative function path, during it', scene(orbit), 0.5, 200, 200);
await one('ranged relative slide, at its start', scene(slide), 0, -500, 50);
await one('ranged relative slide, before it', scene(slideLater), 0.5, -500, 50);
await one('ranged relative slide, during it', scene(slide), 0.3, -300, 100);
await one('ranged relative slide, after it', scene(slide), 1, -300, 100);
await one('turn, during it', scene(turn), 0.5, 0, 100);
await one('ranged fade, during it', scene(fade), 0.25, 0, 100);
await one('move over a path, during both', scene(pathAbs, move), 1.5, 150, 150);
await one('Shift drag after a path', scene(pathAbs), 2, 200, 300, { shiftKey: true });
await setSource(scene()); S().select([]); S().setTime(0); await tick(150);
pre.applyAnimationPreset('bounceIn', undefined, [{ object: 'b', time: null }]); await tick(200);
const withBounce = S().source;
await one('bounce preset, during it', withBounce, 0.4, -100, 100);
await one('bounce preset, after it', withBounce, 1, -100, 100);
S().select([]); S().setTransformMode('all'); await tick(100);
return out;
`

try {
  const cases = await run(MATRIX)
  let failed = 0
  for (const c of cases) {
    const pass = c.ok && c.sane && !c.err
    if (!pass) failed++
    console.log(`${pass ? 'ok  ' : 'FAIL'} ${c.label.padEnd(42)} shown ${JSON.stringify(c.shown)} wanted ${JSON.stringify(c.target)} at ${c.time} s${c.sane ? '' : ', numbers out of range'}${c.err ? `, error: ${c.err}` : ''}`)
  }
  console.log(`${cases.length - failed} of ${cases.length} drags landed`)
  process.exitCode = failed > 0 ? 1 : 0
} finally {
  ws.close()
}
