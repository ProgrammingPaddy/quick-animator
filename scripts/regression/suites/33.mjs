// The scale verb folded into resize: old statements still run with a note, resize takes scale, and the GUI writes resize.
// Steps: reload open scale SCALE1 OFF
import { writeFileSync } from 'node:fs'

const SP = process.env.QA_REGRESSION_HOME
if (!SP) throw new Error('Run the suites through scripts/regression/run.mjs: it makes the scratch project they write to')
const SCRATCH = `${SP}/first/scenes/main.js`
const PROJECT = `${SP}/first`
const targets = await (await fetch('http://127.0.0.1:9222/json')).json()
const page = targets.find((t) => t.type === 'page')
const ws = new WebSocket(page.webSocketDebuggerUrl)
let nextId = 0
const pending = new Map()
const send = (method, params = {}) => new Promise((resolve, reject) => { const id = ++nextId; pending.set(id, { resolve, reject }); ws.send(JSON.stringify({ id, method, params })) })
await new Promise((r) => ws.addEventListener('open', r))
ws.addEventListener('message', (ev) => { const m = JSON.parse(String(ev.data)); const p = pending.get(m.id); if (!p) return; pending.delete(m.id); m.error ? p.reject(new Error(JSON.stringify(m.error))) : p.resolve(m.result) })
// A blur or a focus reaches the app as in a window in front, wherever the test window stands.
await send('Emulation.setFocusEmulationEnabled', { enabled: true }).catch(() => {})
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const frame = () => send('Page.captureScreenshot', { format: 'jpeg', quality: 20 }).catch(() => {})
const run = async (body) => {
  const expression = `(async () => { const ops = await import('/src/project/operations.ts'); const smp = await import('/src/model/sample.ts'); const st = window.__quickAnimator.useStore; const S = () => st.getState(); const tick = (ms = 60) => new Promise(r => setTimeout(r, ms));
const pe = (el, type, x, y, extra = {}) => el.dispatchEvent(new PointerEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y, button: 0, buttons: type === 'pointerup' ? 0 : 1, pointerId: 1, isPrimary: true, pointerType: 'mouse', ...extra }));
const key = (type, k, extra = {}) => window.dispatchEvent(new KeyboardEvent(type, { key: k, code: k === 'Shift' ? 'ShiftLeft' : k, bubbles: true, cancelable: true, ...extra }));
const obj = (name) => S().model.objects.find(o => o.name === name);
const acts = (name) => obj(name).actions.map(a => ({ verb: a.verb, start: a.start, end: a.end, changes: Object.fromEntries(Object.entries(a.changes).map(([k, v]) => [k, typeof v === 'function' ? 'fn' : v])) }));
const clipOf = (name) => document.querySelector('.oclip[data-object="' + name + '"]');
const setSource = async (text) => { const ed = window.__quickAnimator.getEditor(); ed.dispatch({ changes: { from: 0, to: ed.state.doc.length, insert: text } }); await tick(400) };
const setInput = async (el, value) => { const proto = Object.getPrototypeOf(el); const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set; if (setter) setter.call(el, value); else el.value = value; el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true })); await tick(60) };
const commit = async (el, value) => { el.focus(); await setInput(el, value); el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); el.blur(); await tick(200) };
const rowOf = (name) => [...document.querySelectorAll('.now-values tr')].find(tr => tr.querySelector('td.k')?.textContent === name);
const geom = () => { const el = document.querySelector('.preview'); const r = el.getBoundingClientRect(); const zoom = Math.max(Math.min((r.width - 80) / 1920, (r.height - 80) / 1080), 0.02); const sx = (wx) => r.left + r.width / 2 + wx * zoom; const sy = (wy) => r.top + r.height / 2 - wy * zoom; return { el, r, zoom, sx, sy } };
const path = async (g, points, extra = {}) => { const [first, ...rest] = points; pe(g.el, 'pointerdown', g.sx(first.x), g.sy(first.y), extra); pe(g.el, 'pointermove', g.sx(first.x) + 4, g.sy(first.y), extra); let prev = first; for (const p of rest) { const n = Math.max(1, Math.ceil(Math.hypot(p.x - prev.x, p.y - prev.y) / 15)); for (let i = 1; i <= n; i++) pe(g.el, 'pointermove', g.sx(prev.x + (p.x - prev.x) * i / n), g.sy(prev.y + (p.y - prev.y) * i / n), extra); prev = p } pe(g.el, 'pointerup', g.sx(prev.x), g.sy(prev.y), extra); await tick(150) };
const pps = () => { const a = document.querySelectorAll('.tl-ruler .tick'); if (a.length < 2) return null; const t0 = parseFloat(a[0].textContent), t1 = parseFloat(a[1].textContent); return (a[1].getBoundingClientRect().left - a[0].getBoundingClientRect().left) / (t1 - t0) };
const at = (name) => ({ x: obj(name).attrs.x, y: obj(name).attrs.y });
${body} })()`
  const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true, timeout: 120000 })
  if (r.exceptionDetails) return { EXCEPTION: r.exceptionDetails.exception?.description ?? r.exceptionDetails.text }
  return r.result.value
}
const write = async (text) => { await sleep(1500); writeFileSync(SCRATCH, text); await sleep(1500); await frame(); await sleep(200) }
const SCALE = ['r = Rect({', '  x: -300,', '  y: 0,', '  width: 120,', '  height: 60,', '})', '', 'g = Group({', '  members: \'r\',', '})', '', 'b = Circle({', '  x: 200,', '  y: 0,', '  radius: 40,', '})', '', 'b.scale({', '  scale: 2,', '  at: 0,', '  duration: 1,', '})', '', 'g.resize({', '  scale: 1.5,', '  at: 0,', '  duration: 1,', '})', ''].join('\n')

const G = {
  // The scale verb runs as resize with a note at its line; resize takes scale; the GUI writes resize for scalings, with dimensions for an object and scale for a group.
  SCALE1: `await tick(300); const reg = await import('/src/model/registry.ts'); const m = S().model; const loaded = { verbs: [...reg.VERBS], canonical: reg.canonicalVerb('scale'), b: acts('b').map(a => [a.verb, a.changes]), bScaleAtEnd: smp.valueAt(m, obj('b'), 'scale', 1), gScaleAtEnd: smp.valueAt(m, obj('g'), 'scale', 1), rScaleShown: Math.round(smp.valueAt(m, obj('r'), 'scale', 1) * 100) / 100, warnings: m.warnings.map(w => [w.message, w.line]), clipLabels: [...document.querySelectorAll('.oclip[data-object="b"] .clip .label')].map(l => l.textContent.trim()), verbFor: ops.verbFor(['scale']) }; S().setTime(2); ops.addAction('r', 'resize', 2); await tick(250); const rBlock = S().source.slice(S().source.lastIndexOf('r.resize({')); ops.addAction('g', 'resize', 2); await tick(250); const gBlock = S().source.slice(S().source.lastIndexOf('g.resize({')); const written = { r: rBlock.split('\\n').slice(0, 5), g: gBlock.split('\\n').slice(0, 4), rActs: acts('r').map(a => a.verb), gActs: acts('g').map(a => a.verb) }; const undo = document.querySelector('button[title="Undo (Ctrl+Z)"]'); undo.click(); await tick(150); undo.click(); await tick(250); return { loaded, written, restored: !S().source.includes('r.resize({'), err: S().error }`,
  OFF: `S().select([]); S().setTool('select'); await tick(); return { tool: S().tool }`,
}
const scenes = { scale: SCALE }
for (const key of process.argv.slice(2)) {
  if (key === 'open') { console.log('open', JSON.stringify(await run(`await window.__quickAnimator.openProject('${PROJECT}'); await tick(800); return { project: S().project?.path, objects: S().model?.objects.length }`))); continue }
  if (scenes[key]) { await write(scenes[key]); continue }
  if (key === 'reload') { await run(`location.reload()`).catch(() => {}); await sleep(2500); await frame(); await sleep(300); console.log('reloaded'); continue }
  if (key === 'frame') { await frame(); await sleep(300); console.log('frame'); continue }
  console.log(key, JSON.stringify(await run(G[key])))
}
ws.close()
