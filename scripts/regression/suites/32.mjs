// The priority system: the animation on top has the say, lanes by file order, and dragging up or down moves the statement; controls by tool; paths shown by a toggle and by the Path tool.
// Steps: open prio PRIO1 prio LANES2 paths3 TOOLS2 paths3 SHOW1 OFF
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
const PATHS3 = ['p = Rect({', '  x: -300,', '  y: 0,', '  width: 120,', '  height: 60,', '})', '', 'q = Rect({', '  x: 200,', '  y: 300,', '  width: 100,', '  height: 50,', '})', '', 'p.path({', '  shape: [', '    [-300, 0],', '    [0, 200],', '    [300, 0],', '  ],', '  at: 0,', '  duration: 2,', '})', '', 'p.path({', '  shape: [', '    [300, 0],', '    [300, -200],', '  ],', '  at: 3,', '  duration: 1,', '})', ''].join('\n')
const PRIO = ['p = Rect({', '  x: -300,', '  y: 0,', '  width: 120,', '  height: 60,', '})', '', 'a = p.move({', '  x: 300,', '  y: 0,', '  at: 0,', '  duration: 4,', '})', '', 'b = p.move({', '  x: 0,', '  y: 200,', '  at: 1,', '  duration: 1,', '})', ''].join('\n')

const G = {
  // The animation on top has the say while it runs; the one below shows through after; the last to end holds. Moving b below a in the file hands a the say.
  PRIO1: `await tick(300); const m = S().model; const v = (t) => [Math.round(smp.valueAt(m, obj('p'), 'x', t)), Math.round(smp.valueAt(m, obj('p'), 'y', t))]; const before = { at05: v(0.5), at15: v(1.5), at19: v(1.9), at3: v(3), at5: v(5), acts: acts('p').map(a => [a.verb, a.start, a.end]) }; ops.moveAction({ object: 'p', index: 1 }, { before: { object: 'p', index: 0 } }); await tick(300); const m2 = S().model; const v2 = (t) => [Math.round(smp.valueAt(m2, obj('p'), 'x', t)), Math.round(smp.valueAt(m2, obj('p'), 'y', t))]; const after = { order: S().source.indexOf('y: 200') < S().source.indexOf('x: 300'), selected: S().selectedActions, at15: v2(1.5), at3: v2(3), at5: v2(5), acts: acts('p').map(a => [a.verb, a.start, a.end]) }; const defining = smp.definingAction(obj('p'), 'x', 1.5)?.start; document.querySelector('button[title="Undo (Ctrl+Z)"]').click(); await tick(300); return { before, after, defining, undone: S().source.indexOf('y: 200') > S().source.indexOf('x: 300'), err: S().error }`,
  // The clip stacks the later animation above; dragging it below the other moves its statement before the other's and hands over the say.
  LANES2: `await tick(300); const bars = () => [...clipOf('p').querySelectorAll('.clip[data-ref]')].map(el => ({ ref: el.dataset.ref, top: el.getBoundingClientRect().top, label: el.textContent.trim() })); const start = bars(); const b = start.find(x => x.ref === 'p:1'); const a = start.find(x => x.ref === 'p:0'); const el = clipOf('p').querySelector('.clip[data-ref="p:1"]'); const r = el.getBoundingClientRect(); const x = r.left + 20, y = r.top + 8; pe(el, 'pointerdown', x, y); pe(el, 'pointermove', x, y + 10); pe(el, 'pointermove', x, y + 26); pe(el, 'pointermove', x, y + 34); await tick(150); const during = bars().map(x => [x.ref, Math.round(x.top)]); pe(el, 'pointerup', x, y + 34); await tick(300); const after = bars(); const m = S().model; const v = (t) => Math.round(smp.valueAt(m, obj('p'), 'y', t)); return { stacked: b && a ? b.top < a.top : null, during, after: after.map(x => [x.ref, x.label]), order: S().source.indexOf('y: 200') < S().source.indexOf('x: 300'), selected: S().selectedActions, y15: v(1.5), err: S().error }`,
  // Controls by tool: Select shows the transform modes, Object the kinds, Path its Edit and Move path; pressing the object with the Path tool only picks its path; Move path carries all points; in Edit the last point moves like any other.
  TOOLS2: `S().setPreviewSnap({ on: false, edges: false }); S().setTool('select'); S().select(['p']); S().setTime(0); await tick(250); const modes = () => [...document.querySelectorAll('.preview-toolbar .preview-modes button')].map(b => b.textContent.trim()); const selectModes = modes(); S().setTool('object'); await tick(150); const objectModes = modes(); S().setTool('path'); S().setPathMode('edit'); await tick(150); const pathModes = modes(); const g = geom(); const pts = () => smp.pathShape(S().model, obj('p').actions[0], 0).points.map(p => [p.x, p.y]); const drag = async (x0, y0, x1, y1) => { pe(g.el, 'pointerdown', g.sx(x0), g.sy(y0)); pe(g.el, 'pointermove', g.sx((x0 + x1) / 2), g.sy((y0 + y1) / 2)); pe(g.el, 'pointermove', g.sx(x1), g.sy(y1)); pe(g.el, 'pointerup', g.sx(x1), g.sy(y1)); await tick(250) }; S().select([]); await tick(100); await drag(-340, -20, -300, -20); const pressedObject = { selected: S().selectedActions, points: pts() }; await drag(300, 0, 310, 10); const tail = { points: pts(), count: pts().length }; S().setPathMode('move'); await tick(100); await drag(0, 200, 20, 220); const movedAll = pts(); S().setPathMode('edit'); key('keydown', 'Escape'); await tick(100); return { selectModes, objectModes, pathModes, pressedObject, tail, movedAll, tool: S().tool, err: S().error }`,
  // Paths shown: the toggle shows the selected object's paths in Select; the Path tool shows every path, and a hidden one stays hidden until the tool is put away.
  SHOW1: `const r = window.__quickAnimator.getRenderer(); S().setTool('select'); if (!S().showPaths) S().toggleShowPaths(); S().select(['p']); await tick(250); const objectOn = r.pathLineCount(); S().toggleShowPaths(); await tick(200); const objectOff = r.pathLineCount(); S().selectAction('p', 1); await tick(200); const selectedOff = r.pathLineCount(); S().toggleShowPaths(); await tick(200); const selectedOn = r.pathLineCount(); S().select([]); S().setTool('path'); await tick(250); const pathTool = r.pathLineCount(); S().setPathHidden('p:1', true); await tick(200); const hidden = { lines: r.pathLineCount(), keys: [...S().hiddenPaths] }; S().setTool('select'); await tick(200); return { objectOn, objectOff, selectedOff, selectedOn, pathTool, hidden, cleared: S().hiddenPaths.length, err: S().error }`,
  OFF: `S().select([]); S().setTool('select'); S().setPathMode('edit'); S().setPin('start'); S().setTransformMode('all'); if (!S().showPaths) S().toggleShowPaths(); await tick(); return { tool: S().tool }`,
}
const scenes = { paths3: PATHS3, prio: PRIO }
for (const key of process.argv.slice(2)) {
  if (key === 'open') { console.log('open', JSON.stringify(await run(`await window.__quickAnimator.openProject('${PROJECT}'); await tick(800); return { project: S().project?.path, objects: S().model?.objects.length }`))); continue }
  if (scenes[key]) { await write(scenes[key]); continue }
  if (key === 'reload') { await run(`location.reload()`).catch(() => {}); await sleep(2500); await frame(); await sleep(300); console.log('reloaded'); continue }
  if (key === 'frame') { await frame(); await sleep(300); console.log('frame'); continue }
  console.log(key, JSON.stringify(await run(G[key])))
}
ws.close()
