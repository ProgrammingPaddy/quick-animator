// Clips grabbed anywhere, double-clicks that set the playhead, clicks that leave it, handles kept, and the opacity lane by preference.
// Steps: reload open CLICK1 DBL1 HANDLE1 PREF1 CLASS1
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
const TRIM = ['b = Rect({', '  x: 0,', '  y: 0,', '  width: 100,', '  height: 60,', '  at: 1,', '  until: 5,', '})', '', 'c = Rect({', '  x: 300,', '  y: 0,', '  width: 100,', '  height: 60,', '})', '', 'b.move({', '  x: 200,', '  at: 2,', '  duration: 1,', '})', '', 'b.fade({', '  opacity: 0.5,', '  at: 4,', '  duration: 1,', '})', ''].join('\n')
const CLASS = ['a = Rect({', '  x: -300,', '  y: 0,', '  width: 100,', '  height: 60,', "  class: 'bars',", '  until: 5,', '})', '', 'b = Rect({', '  x: 300,', '  y: 0,', '  width: 100,', '  height: 60,', "  class: 'bars',", '  until: 5,', '})', '', "all('bars').move({", '  x: 100,', '  relative: true,', '  at: 1,', '  duration: 1,', '})', ''].join('\n')

const G = {
  // A click anywhere on a clip selects the object and leaves the playhead; a click on an animation selects it alone and leaves the playhead too (D283).
  CLICK1: `await setSource(${JSON.stringify(TRIM)}); if (S().snap) S().toggleSnap(); S().select([]); S().setTime(0); await tick(300); const clip = clipOf('b'); const body = clip.querySelector('.oclip-body'); const br = body.getBoundingClientRect(); const x = br.left + 6, y = br.top + br.height / 2; pe(body, 'pointerdown', x, y); await tick(); pe(body, 'pointerup', x, y); await tick(200); const onBody = { selection: S().selection, actions: S().selectedActions.length, time: S().time, at: obj('b').at }; S().select([]); const lane = clip.querySelector('.oclip-opacity'); const lr = lane.getBoundingClientRect(); pe(lane, 'pointerdown', lr.left + 30, lr.top + 3); await tick(); pe(lane, 'pointerup', lr.left + 30, lr.top + 3); await tick(200); const onLane = { selection: S().selection, time: S().time }; const bar = clip.querySelector('.clip[data-ref="b:0"]'); const rr = bar.getBoundingClientRect(); pe(bar, 'pointerdown', rr.left + rr.width / 2, rr.top + 8); await tick(); pe(bar, 'pointerup', rr.left + rr.width / 2, rr.top + 8); await tick(200); const onBar = { selection: S().selection, actions: S().selectedActions, time: S().time }; return { onBody, onLane, onBar, err: S().error }`,
  // A double-click on the clip's body, its title, or an animation selects and puts the playhead at the start (D283); the lane no longer toggles existence.
  DBL1: `S().select([]); S().setTime(0); await tick(200); const clip = clipOf('b'); const dbl = (el, x, y) => el.dispatchEvent(new MouseEvent('dblclick', { bubbles: true, cancelable: true, clientX: x, clientY: y })); const body = clip.querySelector('.oclip-body'); const br = body.getBoundingClientRect(); dbl(body, br.left + 6, br.top + br.height / 2); await tick(200); const onBody = { selection: S().selection, time: S().time }; S().setTime(0); S().select([]); const title = clip.querySelector('.oclip-title'); const tr = title.getBoundingClientRect(); dbl(title, tr.left + tr.width / 2, tr.top + 8); await tick(200); const onTitle = { selection: S().selection, time: S().time }; S().setTime(0); const bar = clip.querySelector('.clip[data-ref="b:0"]'); const rr = bar.getBoundingClientRect(); dbl(bar, rr.left + rr.width / 2, rr.top + 8); await tick(200); const onBar = { selection: S().selection, actions: S().selectedActions, time: S().time }; S().setTime(0); const lane = clip.querySelector('.oclip-opacity'); const lr = lane.getBoundingClientRect(); dbl(lane, lr.left + 30, lr.top + 3); await tick(200); const onLane = { time: S().time, until: obj('b').until, at: obj('b').at }; return { onBody, onTitle, onBar, onLane, err: S().error }`,
  // The handles inside the clip keep their drags: a fade's end handle retimes the fade, an animation drag retimes it, the object itself staying; a drag from the body moves the object.
  HANDLE1: `S().select([]); S().setTime(0); await tick(200); const p = pps(); const clip = clipOf('b'); const handle = clip.querySelector('.opacity-handle.end'); const hr = handle.getBoundingClientRect(); const hx = hr.left + 4, hy = hr.top + 4; pe(handle, 'pointerdown', hx, hy); await tick(); pe(handle, 'pointermove', hx + 4, hy); await tick(); pe(handle, 'pointermove', hx - p / 2, hy); await tick(); pe(handle, 'pointerup', hx - p / 2, hy); await tick(300); const fade = { end: obj('b').actions[1].end, at: obj('b').at, selection: S().selection }; const bar = clipOf('b').querySelector('.clip[data-ref="b:0"]'); const rr = bar.getBoundingClientRect(); const bx = rr.left + rr.width / 2, by = rr.top + 8; pe(bar, 'pointerdown', bx, by); await tick(); pe(bar, 'pointermove', bx + 4, by); await tick(); pe(bar, 'pointermove', bx + p / 2, by); await tick(); pe(bar, 'pointerup', bx + p / 2, by); await tick(300); const moved = { start: obj('b').actions[0].start, at: obj('b').at }; const body = clipOf('b').querySelector('.oclip-body'); const br = body.getBoundingClientRect(); const x = br.left + 6, y = br.top + br.height / 2; pe(body, 'pointerdown', x, y); await tick(); pe(body, 'pointermove', x + 4, y); await tick(); pe(body, 'pointermove', x + p, y); await tick(); pe(body, 'pointerup', x + p, y); await tick(300); const dragged = { at: obj('b').at, until: obj('b').until, start: obj('b').actions[0].start }; return { fade, moved, dragged, err: S().error }`,
  // The opacity lane by preference (D284): off, the clips carry no lane and are shorter; on again, it is back.
  PREF1: `await setSource(${JSON.stringify(TRIM)}); S().select([]); await tick(300); const h = () => clipOf('b').getBoundingClientRect().height; const before = { lanes: document.querySelectorAll('.oclip-opacity').length, height: h() }; S().setPrefs({ clipOpacity: false }); await tick(300); const off = { lanes: document.querySelectorAll('.oclip-opacity').length, height: h(), handles: document.querySelectorAll('.opacity-handle').length, clips: clipOf('b').querySelectorAll('.clip').length }; S().setPrefs({ clipOpacity: true }); await tick(300); const on = { lanes: document.querySelectorAll('.oclip-opacity').length, height: h() }; const saved = Object.keys(localStorage).filter(k => /pref/i.test(k)).map(k => [k, JSON.parse(localStorage.getItem(k)).clipOpacity]); return { before, off, on, saved, err: S().error }`,
  // A class clip: a click anywhere selects its members; a double-click puts the playhead at its start.
  CLASS1: `await setSource(${JSON.stringify(CLASS)}); S().select([]); S().setTime(0); await tick(400); const clip = document.querySelector('.oclip.class'); if (!clip) return { noClip: true, err: S().error }; const body = clip.querySelector('.oclip-body'); const br = body.getBoundingClientRect(); const x = br.left + 6, y = br.top + br.height / 2; pe(body, 'pointerdown', x, y); await tick(); pe(body, 'pointerup', x, y); body.dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: x, clientY: y })); await tick(200); const clicked = { selection: S().selection, time: S().time }; S().select([]); body.dispatchEvent(new MouseEvent('dblclick', { bubbles: true, cancelable: true, clientX: x, clientY: y })); await tick(200); return { clicked, dbl: { selection: S().selection, time: S().time }, err: S().error }`,
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
