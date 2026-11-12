// Third look at the lanes: the dragged clip follows the pointer, Classes in the clip menu, pushed moves begin at contact, wording.
// Steps: reload open grp FOLLOW1 grp MENU3 push PUSHT1 OFF
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
const me = (el, type, x, y, extra = {}) => el.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y, button: 2, buttons: 2, ...extra }));
const obj = (name) => S().model.objects.find(o => o.name === name);
const acts = (name) => obj(name).actions.map(a => ({ verb: a.verb, start: a.start, end: a.end, changes: a.changes, easeIn: a.timing.easeIn, easeOut: a.timing.easeOut }));
const order = () => S().model.objects.map(o => o.name);
const clipOf = (name) => document.querySelector('.oclip[data-object="' + name + '"]');
const setSource = async (text) => { const ed = window.__quickAnimator.getEditor(); ed.dispatch({ changes: { from: 0, to: ed.state.doc.length, insert: text } }); await tick(400) };
const geom = () => { const el = document.querySelector('.preview'); const r = el.getBoundingClientRect(); const zoom = Math.max(Math.min((r.width - 80) / 1920, (r.height - 80) / 1080), 0.02); const sx = (wx) => r.left + r.width / 2 + wx * zoom; const sy = (wy) => r.top + r.height / 2 - wy * zoom; return { el, r, zoom, sx, sy } };
const path = async (g, points, extra = {}) => { const [first, ...rest] = points; pe(g.el, 'pointerdown', g.sx(first.x), g.sy(first.y), extra); pe(g.el, 'pointermove', g.sx(first.x) + 4, g.sy(first.y), extra); let prev = first; for (const p of rest) { const n = Math.max(1, Math.ceil(Math.hypot(p.x - prev.x, p.y - prev.y) / 15)); for (let i = 1; i <= n; i++) pe(g.el, 'pointermove', g.sx(prev.x + (p.x - prev.x) * i / n), g.sy(prev.y + (p.y - prev.y) * i / n), extra); prev = p } pe(g.el, 'pointerup', g.sx(prev.x), g.sy(prev.y), extra); await tick(150) };
const menuItems = () => (S().contextMenu?.items ?? []).map(i => i.label);
${body} })()`
  const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true, timeout: 120000 })
  if (r.exceptionDetails) return { EXCEPTION: r.exceptionDetails.exception?.description ?? r.exceptionDetails.text }
  return r.result.value
}
const write = async (text) => { await sleep(1500); writeFileSync(SCRATCH, text); await sleep(1500); await frame(); await sleep(200) }

const GRP = ['a = Rect({', '  x: -300,', '  y: 0,', '  width: 200,', '  height: 100,', '  fill: \'#4f8cff\',', '  until: 3,', '})', '', 'b = Circle({', '  x: 300,', '  y: 0,', '  radius: 60,', '  fill: \'#10b981\',', '  at: 1,', '})', '', 'g = Group({', '  members: \'a b\',', '})', '', 'g.move({', '  x: 100,', '  at: 2,', '  duration: 2,', '})', ''].join('\n')

const PUSH = ['p = Rect({', '  x: -300,', '  y: 0,', '  width: 200,', '  height: 100,', '  fill: \'#4f8cff\',', '})', '', 'q = Rect({', '  x: 100,', '  y: 0,', '  width: 200,', '  height: 100,', '  fill: \'#10b981\',', '})', ''].join('\n')

const G = {
  // The dragged clip follows the pointer: 60 px up it sits 60 px up and the order holds; past b's middle the order flips while the clip keeps following; let go, it settles on its level.
  FOLLOW1: `await tick(300); const top = (n) => clipOf(n).getBoundingClientRect().top; const mid = (n) => { const r = clipOf(n).getBoundingClientRect(); return r.top + r.height / 2 }; const a0 = top('a'); const b0 = top('b'); const o0 = order(); const title = clipOf('a').querySelector('.oclip-title'); const r = title.getBoundingClientRect(); const x = r.left + r.width / 2, y = r.top + r.height / 2; pe(title, 'pointerdown', x, y); pe(title, 'pointermove', x, y - 4); pe(title, 'pointermove', x, y - 60); await tick(150); const partWay = { top: top('a'), expect: a0 - 60, dragging: clipOf('a').classList.contains('dragging'), order: order(), line: !!document.querySelector('.tl-drop-line') }; const lift = mid('a') - mid('b') + 20; pe(title, 'pointermove', x, y - 60 - lift); await tick(200); const past = { top: top('a'), expect: a0 - 60 - lift, order: order(), dragging: clipOf('a').classList.contains('dragging') }; pe(title, 'pointerup', x, y - 60 - lift); await tick(250); const settled = { top: top('a'), expectLevelTop: b0, dragging: clipOf('a').classList.contains('dragging'), order: order() }; document.querySelector('.titlebar button[title^="Undo"]').click(); await tick(300); return { o0, partWay, past, settled, undone: order(), err: S().error }`,
  // The clip's menu offers Classes and the action's menu has no Cut; the preview's object menu says Enable passthrough and has no End at.
  MENU3: `await tick(300); const c = clipOf('a'); const cr = c.getBoundingClientRect(); me(c, 'contextmenu', cr.left + 30, cr.top + 8); await tick(100); const clip = menuItems(); S().closeMenu(); await setSource(${JSON.stringify(GRP)} + 'a.move({\\n  x: 0,\\n  at: 1,\\n  duration: 1,\\n})\\n'); await tick(300); const bar = clipOf('a').querySelector('.clip:not(.carried)'); const br = bar.getBoundingClientRect(); me(bar, 'contextmenu', br.left + 10, br.top + 8); await tick(100); const action = menuItems(); S().closeMenu(); const g = geom(); me(g.el, 'contextmenu', g.sx(-300), g.sy(0)); await tick(100); const object = menuItems(); S().closeMenu(); return { clip, action, object }`,
  // A Shift-drag of p into q pushes it: q's move begins when p reaches it, with p's ramps from there, so the two move as one.
  PUSHT1: `S().setTransformMode('move'); S().setPreviewSnap({ on: false, edges: false }); if (!S().collide) S().setCollide(true); if (!S().push) S().setPush(true); S().setPin('start'); S().setChain(false); S().setTime(0); S().select([]); await tick(200); const g = geom(); await path(g, [{ x: -300, y: 0 }, { x: 200, y: 0 }], { shiftKey: true }); window.dispatchEvent(new KeyboardEvent('keyup', { key: 'Shift', code: 'ShiftLeft', bubbles: true })); await tick(150); const p = acts('p'); const q = acts('q'); const ease = (s) => { const a = 0.3, b = 0.3, vmax = 1 / 0.7; if (s < a) return vmax * s * s / (2 * a); if (s > 1 - b) { const r = 1 - s; return 1 - vmax * r * r / (2 * b) } return vmax * (s - a / 2) }; let lo = 0, hi = 1; for (let i = 0; i < 30; i++) { const m = (lo + hi) / 2; if (ease(m) < 0.4) lo = m; else hi = m } return { p, q, expectQStart: +((lo + hi) / 2).toFixed(3), err: S().error }`,
  OFF: `if (S().collide) S().setCollide(false); if (S().push) S().setPush(false); S().setTool('select'); await tick(); return { collide: S().collide, push: S().push }`,
}
const scenes = { grp: GRP, push: PUSH }
for (const key of process.argv.slice(2)) {
  if (key === 'open') { console.log('open', JSON.stringify(await run(`await window.__quickAnimator.openProject('${PROJECT}'); await tick(800); return { project: S().project?.path, objects: S().model?.objects.length }`))); continue }
  if (scenes[key]) { await write(scenes[key]); continue }
  if (key === 'reload') { await run(`location.reload()`).catch(() => {}); await sleep(2500); await frame(); await sleep(300); console.log('reloaded'); continue }
  if (key === 'frame') { await frame(); await sleep(300); console.log('frame'); continue }
  console.log(key, JSON.stringify(await run(G[key])))
}
ws.close()
