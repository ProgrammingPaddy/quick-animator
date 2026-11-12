// A plain change after an end is a new animation (D328), Shift past a selected animation (D329), the pane sections (D330).
// Steps: reload open GAP1 GAP2 GAP3 GAP4 LANE1 SHIFT2 PANE2
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
const NL = String.fromCharCode(10)
const AFTER = ['a = Rect({', '  x: -300,', '  y: 0,', '  width: 100,', '  height: 60,', "  fill: '#4f8cff',", '  until: 8,', '})', '', 'b = Circle({', '  x: 300,', '  y: 0,', '  radius: 40,', '  until: 8,', '})', '', 'a.move({', '  x: 0,', '  at: 1,', '  duration: 1,', '})', ''].join(NL)
const FADES = ['a = Rect({', '  x: -300,', '  y: 0,', '  width: 100,', '  height: 60,', '  until: 8,', '})', '', 'a.fade({', '  opacity: 0.5,', '  at: 1,', '  duration: 1,', '})', '', 'a.fade({', '  opacity: 0,', '  at: 4,', '  duration: 1,', '})', ''].join(NL)
const CLASSY = ['a = Rect({', '  x: -300,', '  y: 0,', '  width: 100,', '  height: 60,', "  class: 'bars',", '  until: 8,', '})', '', "all('bars').move({", '  x: 0,', '  at: 1,', '  duration: 1,', '})', ''].join(NL)
const PATHED = ['p = Rect({', '  x: -300,', '  y: 0,', '  width: 120,', '  height: 60,', '  until: 8,', '})', '', 'p.path({', '  shape: [[-300, 0], [0, 200], [300, 0]],', '  at: 0,', '  duration: 2,', '})', ''].join(NL)
const H = "const prep = async (src) => { await setSource(src); S().setTool('select'); S().setTransformMode('move'); S().setPreviewSnap({ on: false, edges: false }); S().setPin('start'); if (S().chain) S().setChain(false); if (S().snap) S().toggleSnap(); S().select([]); await tick(200) }; const dragA = async (name, dx, dy, extra) => { const g = geom(); const f = window.__quickAnimator.getRenderer().frameOf(name); await path(g, [{ x: f.x, y: f.y }, { x: f.x + dx, y: f.y + dy }], extra); await tick(200) }; const sections = () => [...document.querySelectorAll('.now-values tr.now-section td')].map(td => td.textContent); const rows = () => [...document.querySelectorAll('.now-values tr')].map(tr => tr.classList.contains('now-section') ? '#' + tr.textContent : tr.querySelector('td.k')?.textContent);"

const G = {
  // After a move's end (D328): a plain drag at 4 s writes a new move from the move's end, 2, to 4, landing where the pointer is; the first move keeps its end; the playhead stays; the object stays selected; a second drag at the same time edits that new move, adding nothing.
  GAP1: `await prep(${JSON.stringify(AFTER)}); S().select(['a']); S().setTime(4); await tick(300); await dragA('a', 150, 60); const first = { acts: acts('a'), time: S().time, selection: S().selection, selectedActions: S().selectedActions.length, shown: [Math.round(smp.shownValue(S().model, obj('a'), 'x', 4)), Math.round(smp.shownValue(S().model, obj('a'), 'y', 4))] }; await dragA('a', 40, 0); const second = { acts: acts('a'), count: obj('a').actions.length }; return { first, second, err: S().error }`,
  // At the move's end the plain drag still edits the move's end (D314), before any animation it edits the declaration, and a value typed in the pane after the end writes a new animation as the drag does.
  GAP2: `await prep(${JSON.stringify(AFTER)}); S().select(['a']); S().setTime(2); await tick(300); await dragA('a', 50, 0); const atEnd = { acts: acts('a'), decl: at('a') }; await prep(${JSON.stringify(AFTER)}); S().select(['b']); S().setTime(4); await tick(300); await dragA('b', -60, 30); const noAnimation = { acts: acts('b'), decl: at('b') }; await prep(${JSON.stringify(AFTER)}); S().select(['a']); S().setTime(5); await tick(300); await commit(rowOf('rotation').querySelector('input'), '45'); const typedNew = { acts: acts('a') }; await commit(rowOf('x').querySelector('input'), '200'); const typedX = { acts: acts('a') }; return { atEnd, noAnimation, typedNew, typedX, err: S().error }`,
  // Shift past the end (D328, D329): a Shift-drag at 4 s makes the pinned animation at the playhead, 4 to 5, not one filling the gap from 2; a nudge after the end writes a new move once and then edits it.
  GAP3: `await prep(${JSON.stringify(AFTER)}); S().select(['a']); S().setTime(4); await tick(300); const g = geom(); const f = window.__quickAnimator.getRenderer().frameOf('a'); pe(g.el, 'pointermove', g.sx(f.x), g.sy(f.y)); key('keydown', 'Shift'); await tick(120); const jumped = S().time; await path(g, [{ x: f.x, y: f.y }, { x: f.x + 100, y: f.y }], { shiftKey: true }); key('keyup', 'Shift'); await tick(200); const shifted = { acts: acts('a'), time: S().time }; await prep(${JSON.stringify(AFTER)}); S().select(['a']); S().setTime(4); await tick(300); ops.nudgeObjects(['a'], 10, 0); await tick(150); ops.nudgeObjects(['a'], 10, 0); await tick(150); const nudged = { acts: acts('a') }; return { jumped, shifted, nudged, err: S().error }`,
  // A class move that ended (D328): the member's plain drag after it writes the member's own move from the class move's end, the class move untouched; after a path, a drag writes a move from the path's end and leaves the path's line alone.
  GAP4: `await prep(${JSON.stringify(CLASSY)}); S().select(['a']); S().setTime(4); await tick(300); await dragA('a', 100, 0); const classy = { acts: acts('a'), src: S().source }; await prep(${JSON.stringify(PATHED)}); S().select(['p']); S().setTime(4); await tick(300); await dragA('p', 0, -100); const pathed = { acts: acts('p'), srcShape: /shape: \\[\\[-300, 0\\], \\[0, 200\\], \\[300, 0\\]\\]/.test(S().source), time: S().time }; return { classy, pathed, err: S().error }`,
  // The fade lane's start handle (D328, before): the value before the second fade still goes to the first fade's end, no new fade; dragged up at the second fade's start.
  LANE1: `await prep(${JSON.stringify(FADES)}); S().select(['a']); await tick(300); const lane = clipOf('a').querySelector('.opacity-handle.start, .fade-handle.start, [class*="handle"][class*="start"]'); const handles = [...clipOf('a').querySelectorAll('[class*="handle"]')].map(h => h.className); if (!lane) return { handles }; const r = lane.getBoundingClientRect(); pe(lane, 'pointerdown', r.left + r.width / 2, r.top + r.height / 2); pe(lane, 'pointermove', r.left + r.width / 2, r.top + r.height / 2 - 20); pe(lane, 'pointerup', r.left + r.width / 2, r.top + r.height / 2 - 20); await tick(250); return { handles, acts: acts('a'), err: S().error }`,
  // Shift with an animation selected (D329): the playhead past its end, Shift looks ahead a second from the playhead and the drag makes a new animation; the playhead before its end, Shift still jumps to the end and the drag edits it.
  SHIFT2: `await prep(${JSON.stringify(AFTER)}); S().selectAction('a', 0); S().setTime(4); await tick(300); const g = geom(); const f = window.__quickAnimator.getRenderer().frameOf('a'); pe(g.el, 'pointermove', g.sx(f.x), g.sy(f.y)); key('keydown', 'Shift'); await tick(120); const past = { time: S().time }; await path(g, [{ x: f.x, y: f.y }, { x: f.x + 100, y: f.y }], { shiftKey: true }); key('keyup', 'Shift'); await tick(200); const pastDrag = { acts: acts('a'), time: S().time }; await prep(${JSON.stringify(AFTER)}); S().selectAction('a', 0); S().setTime(0.5); await tick(300); const f2 = window.__quickAnimator.getRenderer().frameOf('a'); pe(g.el, 'pointermove', g.sx(f2.x), g.sy(f2.y)); key('keydown', 'Shift'); await tick(120); const before = { time: S().time }; const f3 = window.__quickAnimator.getRenderer().frameOf('a'); await path(g, [{ x: f3.x, y: f3.y }, { x: f3.x + 100, y: f3.y }], { shiftKey: true }); key('keyup', 'Shift'); await tick(200); const beforeDrag = { acts: acts('a'), time: S().time }; return { past, pastDrag, before, beforeDrag, err: S().error }`,
  // The pane's sections (D330): a Rect reads Life, Position, Size, Color, Classes; a Text adds Text; a group not yet made shows its members in the head and no sentence.
  PANE2: `await prep(${JSON.stringify(AFTER)}); S().select(['a']); S().setTime(0); await tick(300); const rect = rows(); await setSource(${JSON.stringify(AFTER)} + "t = Text({ text: 'Hi', y: 300 })" + String.fromCharCode(10)); S().select(['t']); await tick(300); const text = sections(); S().select(['a', 'b']); await tick(300); const head = document.querySelector('.now-head')?.textContent.replace(/\\s+/g, ' ').trim(); const row = document.querySelector('.object-list li.prospective')?.textContent.replace(/\\s+/g, ' ').trim(); const gap = (() => { const k = document.querySelector('.now-values .key-controls'); const l = document.querySelector('.now-values .link-button'); if (!k || !l) return null; const a = k.getBoundingClientRect(), b = l.getBoundingClientRect(); return { gap: Math.round(b.left - a.right), dy: Math.round((b.top + b.height / 2) - (a.top + a.height / 2)) } })(); return { rect, text, head, row, gap, err: S().error }`,
}
const scenes = {}
for (const key of process.argv.slice(2)) {
  if (key === 'open') { console.log('open', JSON.stringify(await run(`await window.__quickAnimator.openProject('${PROJECT}'); await tick(800); return { project: S().project?.path, objects: S().model?.objects.length }`))); continue }
  if (scenes[key]) { await write(scenes[key]); continue }
  if (key === 'reload') { await run(`location.reload()`).catch(() => {}); await sleep(2500); await frame(); await sleep(300); console.log('reloaded'); continue }
  if (key === 'frame') { await frame(); await sleep(300); console.log('frame'); continue }
  console.log(key, JSON.stringify(await run(H + G[key])))
}
ws.close()
