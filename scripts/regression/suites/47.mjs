// The start principle (D258): every action begins from the state at its first frame, in time order, whichever way the actions are written.
// Steps: reload open ORDER1 OVERLAP1 SAMESTART1 RANGE1 GROUP1 RELATIVE1 CHAIN3
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
// An action never dictates its start (D258): it begins from the state the object is in when its first frame is active, in time order, whichever way the actions are written.
const ORDER = ['b = Rect({', '  x: 0,', '  y: 0,', '  width: 100,', '  height: 60,', '})', '', 'b.move({', '  x: 400,', '  at: 2,', '  duration: 1,', "  ease: 'linear',", '})', '', 'b.move({', '  x: 200,', '  at: 0,', '  duration: 1,', "  ease: 'linear',", '})', ''].join('\n')
const OVERLAP = ['b = Rect({', '  x: 0,', '  y: 0,', '  width: 100,', '  height: 60,', '})', '', 'b.move({', '  x: 0,', '  at: 1,', '  duration: 2,', "  ease: 'linear',", '})', '', 'b.move({', '  x: 400,', '  at: 0,', '  duration: 2,', "  ease: 'linear',", '})', ''].join('\n')
const SAME = ['b = Rect({', '  x: 0,', '  y: 0,', '  width: 100,', '  height: 60,', '})', '', 'b.move({', '  x: 100,', '  at: 0,', '  duration: 2,', "  ease: 'linear',", '})', '', 'b.move({', '  x: 400,', '  at: 0,', '  duration: 1,', "  ease: 'linear',", '})', ''].join('\n')
const RANGE = ['b = Rect({', '  x: 0,', '  y: 0,', '  width: 100,', '  height: 60,', '})', '', 'b.move({', '  x: 100,', '  at: 0,', '  duration: 0.5,', "  ease: 'linear',", '})', '', 'b.move({', '  x: [300, 500],', '  at: 1,', '  duration: 1,', "  ease: 'linear',", '})', ''].join('\n')
const GROUPED = ['a = Rect({', '  x: -100,', '  y: 0,', '  width: 60,', '  height: 60,', '})', '', 'c = Rect({', '  x: 100,', '  y: 0,', '  width: 60,', '  height: 60,', '})', '', 'g = Group({', "  members: 'a c',", '})', '', 'g.rotate({', '  rotation: 90,', '  at: 2,', '  duration: 1,', "  ease: 'linear',", '})', '', 'g.rotate({', '  rotation: 40,', '  at: 0,', '  duration: 1,', "  ease: 'linear',", '})', ''].join('\n')
const RELATIVE = ['b = Rect({', '  x: 0,', '  y: 0,', '  width: 100,', '  height: 60,', '})', '', 'b.move({', '  x: 400,', '  at: 2,', '  duration: 1,', "  ease: 'linear',", '})', '', 'b.move({', '  x: 50,', '  relative: true,', '  at: 0,', '  duration: 1,', "  ease: 'linear',", '})', ''].join('\n')
const CHAINED3 = ['b = Rect({', '  x: 0,', '  y: 0,', '  width: 100,', '  height: 60,', '})', '', 'b.move({', '  x: 300,', '  at: 4,', '  duration: 1,', "  ease: 'linear',", '})', '', 'b.move({', '  x: 100,', '  at: 0,', '  duration: 1,', "  ease: 'linear',", '})', '', 'b.move({', '  x: 200,', '  at: 2,', '  duration: 1,', "  ease: 'linear',", '})', ''].join('\n')

const G = {
  // Written first but timed second, a move begins where the earlier one left the object, not at the declaration.
  ORDER1: `await setSource(${JSON.stringify(ORDER)}); S().select([]); S().setTime(0); await tick(300); const x = (t) => Math.round(smp.valueAt(S().model, obj('b'), 'x', t) * 100) / 100; return { at0: x(0), at05: x(0.5), at15: x(1.5), at2: x(2), at225: x(2.25), at3: x(3), at9: x(9), err: S().error }`,
  // Overlapping moves stack as written (D210): the top one has the say while it runs, and the lower one, which began under it from the state at its own first frame, shows through when the top one ends.
  OVERLAP1: `await setSource(${JSON.stringify(OVERLAP)}); S().select([]); S().setTime(0); await tick(300); const x = (t) => Math.round(smp.valueAt(S().model, obj('b'), 'x', t) * 100) / 100; return { at05: x(0.5), at15: x(1.5), at2: x(2), at2001: x(2.001), at25: x(2.5), at3: x(3), err: S().error }`,
  // Two moves beginning at the same moment both begin from what came before them.
  SAMESTART1: `await setSource(${JSON.stringify(SAME)}); S().select([]); S().setTime(0); await tick(300); const x = (t) => Math.round(smp.valueAt(S().model, obj('b'), 'x', t) * 100) / 100; return { at05: x(0.5), at1: x(1), at15: x(1.5), at2: x(2), err: S().error }`,
  // A start written as a range stays the one written exception (D221): the move begins from it.
  RANGE1: `await setSource(${JSON.stringify(RANGE)}); S().select([]); S().setTime(0); await tick(300); const x = (t) => Math.round(smp.valueAt(S().model, obj('b'), 'x', t) * 100) / 100; return { at025: x(0.25), at075: x(0.75), at1: x(1), at15: x(1.5), at2: x(2), err: S().error }`,
  // A group's turn written first but timed second begins from the turn the earlier one left.
  GROUP1: `await setSource(${JSON.stringify(GROUPED)}); S().select([]); S().setTime(0); await tick(300); const rot = (t) => Math.round(smp.valueAt(S().model, obj('g'), 'rotation', t) * 100) / 100; const pose = (t) => { const p = smp.worldPose(S().model, obj('a'), t); return [Math.round(p.x), Math.round(p.y), Math.round(p.rotation)] }; return { rot15: rot(1.5), rot25: rot(2.5), rot3: rot(3), a15: pose(1.5), a25: pose(2.5), a3: pose(3), err: S().error }`,
  // A relative change adds on top of whatever else moves the object, so the later absolute move begins from the declaration plus it.
  RELATIVE1: `await setSource(${JSON.stringify(RELATIVE)}); S().select([]); S().setTime(0); await tick(300); const x = (t) => Math.round(smp.valueAt(S().model, obj('b'), 'x', t) * 100) / 100; return { at05: x(0.5), at15: x(1.5), at25: x(2.5), at3: x(3), err: S().error }`,
  // Three moves written in a different order than they run: each begins where the one before it in time ended.
  CHAIN3: `await setSource(${JSON.stringify(CHAINED3)}); S().select([]); S().setTime(0); await tick(300); const x = (t) => Math.round(smp.valueAt(S().model, obj('b'), 'x', t) * 100) / 100; return { at05: x(0.5), at15: x(1.5), at25: x(2.5), at35: x(3.5), at45: x(4.5), at5: x(5), err: S().error }`,
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
