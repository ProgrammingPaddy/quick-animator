// States as time references with stretches and directions, the links dialog states, the Presets pane, the code pane number drag and ease menu, and tool icons.
// Steps: reload open states STATES1 states DIALOG2 ease CODE1 OFF
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
const STATES = ['b = Rect({', '  x: -300,', '  y: 0,', '  width: 100,', '  height: 60,', '})', '', 'd = Circle({', '  x: 300,', '  y: 0,', '  radius: 40,', '  opacity: 0,', '})', '', 'b.move({', '  x: 0,', '  at: 0,', '  duration: 1,', '})', '', 'b.move({', '  x: 0,', '  y: 200,', '  at: 2,', '  duration: 1,', '})', '', 'b.rotate({', '  rotation: -90,', '  at: 4,', '  duration: 1,', '})', '', 'b.resize({', '  scale: 2,', '  at: 5,', '  duration: 1,', '})', '', 'd.fade({', '  opacity: 1,', '  at: b.moving[2].end,', '  duration: 0.5,', '})', '', 'd.move({', '  x: 0,', '  at: b.still.last.start,', '  duration: 0.5,', '})', ''].join('\n')
const EASE = ['a = Rect({', '  x: -300,', '  y: 0,', '  width: 100,', '  height: 60,', '})', '', 'a.move({', '  x: 0,', '  ease: \'snap\',', '  duration: 1,', '})', ''].join('\n')

const G = {
  // States: stretches of moving with a break, directions, turning, growing, visibility; references to them resolve; a missing stretch is an error at the line.
  STATES1: `await tick(300); const m = S().model; const stretch = (o, name, dir) => smp.stateStretches(m, obj(o), name, dir, 60).map(s => [Math.round(s.start * 1000) / 1000, Math.round(s.end * 1000) / 1000]); const states = { moving: stretch('b', 'moving'), right: stretch('b', 'moving', 'right'), up: stretch('b', 'moving', 'up'), left: stretch('b', 'moving', 'left'), still: stretch('b', 'still'), clockwise: stretch('b', 'turning', 'clockwise'), counter: stretch('b', 'turning', 'counterclockwise'), growing: stretch('b', 'growing'), shrinking: stretch('b', 'shrinking'), dVisible: stretch('d', 'visible'), dFadingIn: stretch('d', 'fadingIn') }; const resolved = { fade: acts('d')[0].start, move: acts('d')[1].start, warnings: m.warnings.map(w => w.message), err: S().error }; const back = S().source; await setSource(back.replace('b.moving[2].end', 'b.moving[5].end')); const missing = { message: S().error?.message, line: S().error?.line }; await setSource(back.replace('b.moving[2].end', 'b.turning.counterclockwise.end')); const never = { message: S().error?.message }; await setSource(back); return { states, resolved, missing, never, restored: !S().error, err: S().error }`,
  // The links dialog: an object's row opens to its states under "while", each to its stretches; picking one writes the reference.
  DIALOG2: `S().openLinksDialog({ object: 'd', index: 1, key: 'at' }); await tick(250); const dlg = document.querySelector('.links-dialog'); const row = [...dlg.querySelectorAll('.links-row')].find(r => r.textContent.includes('b ') && r.textContent.includes('Rect')); if (!row.classList.contains('open')) { row.querySelector('.links-what').click(); await tick(150) } const heads = [...row.querySelectorAll('.links-group-heads button')].map(b => b.textContent.trim()); const moving = [...row.querySelectorAll('.links-group-heads button')].find(b => b.textContent.trim().startsWith('moving (')); moving.click(); await tick(150); const parts = [...row.querySelectorAll('.links-groups .links-parts button')].map(b => b.textContent.trim()); [...row.querySelectorAll('.links-groups .links-parts button')].find(b => b.textContent.trim().startsWith('2 end')).click(); await tick(300); const written = { src: S().source.includes('at: b.moving[2].end,'), moveStart: acts('d')[1].start }; dlg.querySelector('.dialog-actions button').click(); await tick(100); document.querySelector('button[title="Undo (Ctrl+Z)"]').click(); await tick(250); return { heads, parts, written, undone: S().source.includes('at: b.still.last.start,'), err: S().error }`,
  // The code pane: Alt and a drag on a number changes it in one undo step; the arrow after an ease name opens the list.
  CODE1: `await tick(300); const ed = window.__quickAnimator.getEditor(); const doc = ed.state.doc.toString(); const pos = doc.indexOf('width: 100') + 8; ed.dispatch({ selection: { anchor: pos } }); await tick(100); const c = ed.coordsAtPos(pos); const x = (c.left + c.right) / 2, y = (c.top + c.bottom) / 2; ed.contentDOM.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, clientX: x, clientY: y, button: 0, altKey: true })); window.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, clientX: x + 20, clientY: y })); window.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, clientX: x + 40, clientY: y })); window.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, clientX: x + 40, clientY: y })); await tick(300); const scrubbed = { src: S().source.includes('width: 110'), width: obj('a').attrs.width }; document.querySelector('button[title="Undo (Ctrl+Z)"]').click(); await tick(250); const undone = S().source.includes('width: 100'); const widget = document.querySelector('.cm-ease-widget'); widget.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, button: 0 })); await tick(150); const menu = [...document.querySelectorAll('.cm-ease-menu button')].map(b => [b.textContent, b.classList.contains('on')]); [...document.querySelectorAll('.cm-ease-menu button')].find(b => b.textContent === 'bounce').dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, button: 0 })); await tick(250); const picked = { src: S().source.includes("ease: 'bounce',"), menuGone: !document.querySelector('.cm-ease-menu') }; return { scrubbed, undone, menu, picked, icons: document.querySelectorAll('.preview-palette button svg').length, titles: [...document.querySelectorAll('.preview-palette button')].map(b => b.getAttribute('aria-label')), err: S().error }`,
  OFF: `S().select([]); S().setTool('select'); await tick(); return { tool: S().tool }`,
}
const scenes = { states: STATES, ease: EASE }
for (const key of process.argv.slice(2)) {
  if (key === 'open') { console.log('open', JSON.stringify(await run(`await window.__quickAnimator.openProject('${PROJECT}'); await tick(800); return { project: S().project?.path, objects: S().model?.objects.length }`))); continue }
  if (scenes[key]) { await write(scenes[key]); continue }
  if (key === 'reload') { await run(`location.reload()`).catch(() => {}); await sleep(2500); await frame(); await sleep(300); console.log('reloaded'); continue }
  if (key === 'frame') { await frame(); await sleep(300); console.log('frame'); continue }
  console.log(key, JSON.stringify(await run(G[key])))
}
ws.close()
