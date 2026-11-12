// Paint, second look: Shift-click as a Shift-made animation, the dropper and Alt-click, the project colors; Apply creates the typed class.
// Steps: reload open SHIFTFILL1 DROP1 CLASSES1
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
const PAINT = ['b = Rect({', '  x: -200,', '  y: 0,', '  width: 200,', '  height: 120,', "  fill: '#4f8cff',", '  until: 8,', '})', '', 'c = Circle({', '  x: 200,', '  y: 0,', '  radius: 70,', "  fill: '#10b981',", "  stroke: '#ffcc00',", '  until: 8,', '})', ''].join('\n')

const G = {
  // Shift-click with Paint makes a color change as any Shift-made animation (D294): from where the playhead was before Shift looked ahead, a second long, the playhead at its end while Shift is held and back after; in Chain mode the next follows; with Ends at playhead it ends at the playhead.
  SHIFTFILL1: `await setSource(${JSON.stringify(PAINT)}); S().setTool('paint'); S().select([]); S().setPin('start'); if (S().chain) S().setChain(false); S().setTime(2); await tick(300); const g = geom(); pe(g.el, 'pointermove', g.sx(-200), g.sy(0)); await tick(); key('keydown', 'Shift', { shiftKey: true }); await tick(100); const ahead = S().time; pe(g.el, 'pointerdown', g.sx(-200), g.sy(0), { shiftKey: true }); await tick(); pe(g.el, 'pointerup', g.sx(-200), g.sy(0), { shiftKey: true }); await tick(300); const made = obj('b').actions.map(a => ({ verb: a.verb, fill: a.changes.fill, start: a.start, end: a.end })); const shown = S().time; key('keyup', 'Shift'); await tick(200); const restored = S().time; S().select([]); S().setChain(true); S().setTime(4); await tick(100); pe(g.el, 'pointermove', g.sx(200), g.sy(0)); await tick(); key('keydown', 'Shift', { shiftKey: true }); await tick(100); pe(g.el, 'pointerdown', g.sx(200), g.sy(0), { shiftKey: true }); await tick(); pe(g.el, 'pointerup', g.sx(200), g.sy(0), { shiftKey: true }); await tick(300); pe(g.el, 'pointerdown', g.sx(200), g.sy(0), { shiftKey: true }); await tick(); pe(g.el, 'pointerup', g.sx(200), g.sy(0), { shiftKey: true }); await tick(300); const chained = obj('c').actions.map(a => [a.start, a.end]); key('keyup', 'Shift'); await tick(200); const rest = S().time; S().select([]); S().setChain(false); S().setPin('end'); S().setTime(7); await tick(100); pe(g.el, 'pointerdown', g.sx(-200), g.sy(0), { shiftKey: true }); await tick(); pe(g.el, 'pointerup', g.sx(-200), g.sy(0), { shiftKey: true }); await tick(300); const ending = obj('b').actions.slice(-1).map(a => [a.start, a.end]); S().setPin('start'); S().setTool('select'); return { ahead, made, shown, restored, chained, rest, ending, err: S().error }`,
  // The dropper and Alt-click take an object's fill as the color (D294); the bar lists the colors used lately and the project's own.
  DROP1: `await setSource(${JSON.stringify(PAINT)}); S().setTool('paint'); S().select([]); S().setTime(1); await tick(300); const g = geom(); pe(g.el, 'pointerdown', g.sx(200), g.sy(0), { altKey: true }); await tick(); pe(g.el, 'pointerup', g.sx(200), g.sy(0), { altKey: true }); await tick(300); const color = () => document.querySelector('.paint-bar .color-swatch'); const well = () => { const el = color(); return el ? '#' + (el.style.backgroundColor.match(/[0-9]+/g) ?? []).slice(0, 3).map(n => Number(n).toString(16).padStart(2, '0')).join('') : null }; const alt = well(); color()?.click(); await tick(100); document.querySelector('.paint-bar .dropper')?.click(); await tick(100); const dropping = document.querySelector('.preview')?.classList.contains('dropping'); pe(g.el, 'pointerdown', g.sx(-200), g.sy(0)); await tick(); pe(g.el, 'pointerup', g.sx(-200), g.sy(0)); await tick(300); const picked = well(); const stillDropping = document.querySelector('.preview')?.classList.contains('dropping'); const swatches = [...document.querySelectorAll('.paint-bar .color-recent .swatch')].map(s => s.title); color()?.click(); await tick(100); const lists = [...document.querySelectorAll('.paint-bar .color-group')].map(grp => [grp.querySelector('.color-label')?.textContent ?? '', ...[...grp.querySelectorAll('.swatch')].map(s => s.title)]); const active = [...document.querySelectorAll('.paint-bar .swatch.active')].map(s => s.title); const cs = getComputedStyle(document.querySelector('.paint-bar .swatch')); S().setTool('select'); return { alt, dropping, picked, stillDropping, swatches, lists, active, swatch: { width: cs.width, height: cs.height }, gap: getComputedStyle(document.querySelector('.paint-bar')).gap, err: S().error }`,
  // Apply in the Classes dialog creates the typed name and applies it (D295); Enter still creates and keeps the dialog open.
  CLASSES1: `await setSource(${JSON.stringify(PAINT)}); S().select([]); await tick(300); S().openClassesDialog(['b', 'c']); await tick(300); const input = document.querySelector('.classes-dialog input[placeholder=name]'); await setInput(input, 'bars'); document.querySelector('.classes-dialog .dialog-actions .primary')?.click(); await tick(400); const applied = { b: obj('b').classes, c: obj('c').classes, open: !!document.querySelector('.classes-dialog') }; S().openClassesDialog(['b']); await tick(300); const input2 = document.querySelector('.classes-dialog input[placeholder=name]'); await setInput(input2, 'tall'); input2.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); await tick(200); const afterEnter = { open: !!document.querySelector('.classes-dialog'), listed: [...document.querySelectorAll('.classes-dialog .class-list .mono')].map(e => e.textContent) }; document.querySelector('.classes-dialog .dialog-actions .primary')?.click(); await tick(400); return { applied, afterEnter, b: obj('b').classes, err: S().error }`,
}

const scenes = {}
for (const key of process.argv.slice(2)) {
  if (key === 'open') { console.log('open', JSON.stringify(await run(`await window.__quickAnimator.openProject('${PROJECT}'); await tick(800); return { project: S().project?.path, objects: S().model?.objects.length }`))); continue }
  if (scenes[key]) { await write(scenes[key]); continue }
  if (key === 'reload') { await run(`location.reload()`).catch(() => {}); await sleep(2500); await frame(); await sleep(300); console.log('reloaded'); continue }
  if (key === 'frame') { await frame(); await sleep(300); console.log('frame'); continue }
  console.log(key, JSON.stringify(await run(G[key])))
}
ws.close()
