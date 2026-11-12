// After the lanes: fade deletion, the hold, side-handle proportions, members on group clips, diagonal clip drags, the selected animation's start and end states.
// Steps: reload open fade FADE1 hold HOLD1 life ASPECT1 grp MEMBERS1 grp DIAG1 life CLICK2 life SEL1 life SEL2 life SEL3 CURSOR1 OFF
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
const life = (name) => ({ at: obj(name).at, until: obj(name).until });
const acts = (name) => obj(name).actions.map(a => [a.verb, a.start, a.end, a.changes]);
const clipOf = (name) => document.querySelector('.oclip[data-object="' + name + '"]');
const setSource = async (text) => { const ed = window.__quickAnimator.getEditor(); ed.dispatch({ changes: { from: 0, to: ed.state.doc.length, insert: text } }); await tick(400) };
const dragEl = async (el, dxPx, dyPx = 0, steps = 4) => { const r = el.getBoundingClientRect(); const x = r.left + r.width / 2, y = r.top + r.height / 2; pe(el, 'pointerdown', x, y); pe(el, 'pointermove', x + (dyPx ? 0 : 4), y + (dyPx ? 4 * Math.sign(dyPx) : 0)); for (let i = 1; i <= steps; i++) pe(el, 'pointermove', x + dxPx * i / steps, y + dyPx * i / steps); pe(el, 'pointerup', x + dxPx, y + dyPx); await tick(100) };
const geom = () => { const el = document.querySelector('.preview'); const r = el.getBoundingClientRect(); const zoom = Math.max(Math.min((r.width - 80) / 1920, (r.height - 80) / 1080), 0.02); const sx = (wx) => r.left + r.width / 2 + wx * zoom; const sy = (wy) => r.top + r.height / 2 - wy * zoom; return { el, r, zoom, sx, sy } };
const dragPreview = async (fromWorld, toWorld, extra = {}, steps = 4) => { const g = geom(); const x0 = g.sx(fromWorld.x), y0 = g.sy(fromWorld.y), x1 = g.sx(toWorld.x), y1 = g.sy(toWorld.y); pe(g.el, 'pointerdown', x0, y0, extra); for (let i = 1; i <= steps; i++) pe(g.el, 'pointermove', x0 + (x1 - x0) * i / steps, y0 + (y1 - y0) * i / steps, extra); pe(g.el, 'pointerup', x1, y1, extra); await tick(120) };
const pps = () => { const a = document.querySelectorAll('.tl-ruler .tick'); if (a.length < 2) return null; const t0 = parseFloat(a[0].textContent), t1 = parseFloat(a[1].textContent); return (a[1].getBoundingClientRect().left - a[0].getBoundingClientRect().left) / (t1 - t0) };
${body} })()`
  const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true, timeout: 120000 })
  if (r.exceptionDetails) return { EXCEPTION: r.exceptionDetails.exception?.description ?? r.exceptionDetails.text }
  return r.result.value
}
const write = async (text) => { await sleep(1500); writeFileSync(SCRATCH, text); await sleep(1500); await frame(); await sleep(200) }

const FADE = ['a = Rect({', '  x: -300,', '  y: 0,', '  width: 200,', '  height: 100,', '  opacity: 0,', '})', '', 'b = Circle({', '  x: 300,', '  y: 0,', '  radius: 60,', '  opacity: 0.5,', '})', '', 'a.fade({', '  opacity: 1,', '  at: 1,', '  duration: 0.5,', '})', '', 'b.fade({', '  opacity: 1,', '  at: 1,', '  duration: 0.5,', '})', '', 'b.fade({', '  opacity: 0,', '  at: 3,', '  duration: 0.5,', '})', ''].join('\n')

const HOLD = ['a = Rect({', '  x: -300,', '  y: 0,', '  width: 200,', '  height: 100,', '  until: 2,', '})', '', 'b = Circle({', '  x: 300,', '  y: 0,', '  radius: 60,', '  until: 1,', '})', '', 'c = Text({', '  text: \'to the end\',', '  y: 300,', '})', '', 'a.move({', '  x: 0,', '  duration: 1,', '})', ''].join('\n')

const LIFE = ['a = Rect({', '  x: -400,', '  y: 100,', '  width: 240,', '  height: 140,', '  fill: \'#4f8cff\',', '  until: 3,', '})', '', 'b = Rect({', '  x: 100,', '  y: -200,', '  width: 160,', '  height: 60,', '  fill: \'#10b981\',', '  at: a.end,', '})', '', 'c = Circle({', '  x: 400,', '  y: 300,', '  radius: 50,', '  fill: \'#f59e0b\',', '  at: 1,', '})', '', 'a.move({', '  x: 0,', '  at: 1,', '  duration: 1,', '})', '', 'c.move({', '  y: 0,', '  duration: 1,', '})', ''].join('\n')

const GRP = ['a = Rect({', '  x: -300,', '  y: 0,', '  width: 200,', '  height: 100,', '  fill: \'#4f8cff\',', '  until: 3,', '})', '', 'b = Circle({', '  x: 300,', '  y: 0,', '  radius: 60,', '  fill: \'#10b981\',', '  at: 1,', '})', '', 'g = Group({', '  members: \'a b\',', '})', '', 'g.move({', '  x: 100,', '  at: 2,', '  duration: 2,', '})', ''].join('\n')

const G = {
  // Deleting a's only fade removes the written opacity 0 from its declaration; deleting one of b's two fades leaves b's 0.5; deleting the other removes it.
  FADE1: `await tick(300); ops.deleteActions([{ object: 'a', index: 0 }], true); await tick(); const aAfter = { attr: obj('a').attrs.opacity, fades: acts('a').length, shown: smp.valueAt(S().model, obj('a'), 'opacity', 2) }; ops.deleteActions([{ object: 'b', index: 1 }], true); await tick(); const bOne = { attr: obj('b').attrs.opacity, fades: acts('b').length }; ops.deleteActions([{ object: 'b', index: 0 }], true); await tick(); const bNone = { attr: obj('b').attrs.opacity, fades: acts('b').length, shown: smp.valueAt(S().model, obj('b'), 'opacity', 2) }; return { aAfter, bOne, bNone, err: S().error }`,
  // The hold: a, removed at the content end (2), stays on through the hold; b, removed at 1, does not; c lasts anyway. The renderer draws a past the end.
  HOLD1: `await tick(300); const m = S().model; const r = window.__quickAnimator.getRenderer(); const ex = (n, t) => smp.existsAt(m, obj(n), t); r.update(m, 2.3, [], 'all', 1, 0); const drawn = { a: r.items.get('a').mesh.visible, b: r.items.get('b').mesh.visible, c: r.items.get('c').mesh.visible }; r.update(m, S().time, [], 'all', 1, 0); return { contentEnd: m.contentEnd, storeEnd: S().contentEnd, a: [ex('a', 1.9), ex('a', 2), ex('a', 2.4)], b: [ex('b', 0.5), ex('b', 1.5)], c: ex('c', 2.4), drawn, err: S().error }`,
  // Alt on a side handle keeps the proportions: the right edge dragged out grows the height with the width, the left edge stays, the center stays level.
  ASPECT1: `await tick(300); S().setTransformMode('all'); S().select(['a']); S().setTime(0); await tick(200); const r = window.__quickAnimator.getRenderer(); const h = r.handles.find(h => h.handle.kind === 'resize' && h.handle.sx === 1 && h.handle.sy === 0); const g = geom(); const d = 60 / g.zoom; await dragPreview({ x: h.x, y: h.y }, { x: h.x + d, y: h.y }, { altKey: true }); const a = obj('a').attrs; return { handle: !!h, width: a.width, height: a.height, x: a.x, y: a.y, ratio: +(a.width / a.height).toFixed(3), expectRatio: +(240 / 140).toFixed(3), leftEdge: +(a.x - a.width / 2).toFixed(1), expectLeft: -520, err: S().error }`,
  // The group's clip names its members.
  MEMBERS1: `await tick(300); return { title: clipOf('g').querySelector('.oclip-title').textContent, members: clipOf('g').querySelector('.members')?.textContent }`,
  // One drag moves a's clip a second later and above b at once, in one undo step.
  DIAG1: `await tick(300); const p = pps(); const top = (n) => clipOf(n).getBoundingClientRect().top; const dy = top('b') - top('a') - 10; const order0 = S().model.objects.map(o => o.name); const before = life('a'); await dragEl(clipOf('a').querySelector('.oclip-title'), p * 1, dy, 6); await tick(200); const after = { life: life('a'), order: S().model.objects.map(o => o.name), aAbove: top('a') < top('b') }; document.querySelector('.titlebar button[title^="Undo"]').click(); await tick(300); return { order0, before, after, undone: { life: life('a'), order: S().model.objects.map(o => o.name) }, err: S().error }`,
  // Clicking a clip puts the playhead at the animation's start and selects it; dragging it does not move the playhead.
  CLICK2: `S().setTime(2.5); await tick(300); const clip = clipOf('a').querySelector('.clip'); const r = clip.getBoundingClientRect(); pe(clip, 'pointerdown', r.left + 20, r.top + 8); pe(clip, 'pointerup', r.left + 20, r.top + 8); await tick(150); const clicked = { time: S().time, selected: S().selectedActions }; S().setTime(2.5); await tick(); await dragEl(clipOf('a').querySelector('.clip'), pps() * 0.5); return { clicked, afterDrag: { time: S().time, acts: acts('a').map(a => a.slice(0, 3)) }, err: S().error }`,
  // With the animation selected, a plain drag in the preview sets its start state: the declaration moves, the destination stays, the playhead sits at the start.
  SEL1: `await tick(300); const clip = clipOf('a').querySelector('.clip'); const r = clip.getBoundingClientRect(); pe(clip, 'pointerdown', r.left + 20, r.top + 8); pe(clip, 'pointerup', r.left + 20, r.top + 8); await tick(150); S().setTime(1.5); await tick(100); const g = geom(); const rend = window.__quickAnimator.getRenderer(); const f0 = rend.frameOf('a'); const d = 50 / g.zoom; await dragPreview({ x: f0.x, y: f0.y }, { x: f0.x + d, y: f0.y }); const a = obj('a'); return { pressedAt: f0.x, time: S().time, declX: a.attrs.x, dest: a.actions[0].changes, selected: S().selectedActions, err: S().error }`,
  // Shift with the animation selected jumps to its end; a Shift-drag sets its end state and makes nothing new; releasing Shift returns the playhead.
  SEL2: `S().setPreviewSnap({ on: false, edges: false }); await tick(300); const clip = clipOf('a').querySelector('.clip'); const r = clip.getBoundingClientRect(); pe(clip, 'pointerdown', r.left + 20, r.top + 8); pe(clip, 'pointerup', r.left + 20, r.top + 8); await tick(150); const g = geom(); pe(g.el, 'pointermove', g.sx(0), g.sy(100)); key('keydown', 'Shift'); await tick(100); const jumped = S().time; const d = 50 / g.zoom; await dragPreview({ x: 0, y: 100 }, { x: d, y: 100 }, { shiftKey: true }); const a = obj('a'); const after = { count: a.actions.length, dest: a.actions[0].changes, declX: a.attrs.x, time: S().time }; key('keyup', 'Shift'); await tick(100); return { jumped, after, restored: S().time, err: S().error }`,
  // Shift with a move selected and a rotation dragged: a rotate over the move's span, no extra move.
  SEL3: `S().setTransformMode('all'); await tick(300); const clip = clipOf('a').querySelector('.clip'); const r = clip.getBoundingClientRect(); pe(clip, 'pointerdown', r.left + 20, r.top + 8); pe(clip, 'pointerup', r.left + 20, r.top + 8); await tick(150); const g = geom(); pe(g.el, 'pointermove', g.sx(0), g.sy(100)); key('keydown', 'Shift'); await tick(100); const rend = window.__quickAnimator.getRenderer(); const h = rend.handles.find(h => h.handle.kind === 'rotate'); const f = rend.frameOf('a'); const a0 = Math.atan2(h.y - f.y, h.x - f.x); const rad = Math.hypot(h.x - f.x, h.y - f.y); const a1 = a0 + Math.PI / 6; await dragPreview({ x: h.x, y: h.y }, { x: f.x + rad * Math.cos(a1), y: f.y + rad * Math.sin(a1) }, { shiftKey: true }); key('keyup', 'Shift'); await tick(100); return { acts: acts('a').map(x => [x[0], x[1], x[2]]), err: S().error }`,
  CURSOR1: `await tick(300); const h = document.querySelector('.opacity-handle.start'); return { cursor: h ? getComputedStyle(h).cursor : 'no handle' }`,
  OFF: `if (S().collide) S().setCollide(false); await tick(); return { tool: S().tool }`,
}
const scenes = { fade: FADE, hold: HOLD, life: LIFE, grp: GRP }
for (const key of process.argv.slice(2)) {
  if (key === 'open') { console.log('open', JSON.stringify(await run(`await window.__quickAnimator.openProject('${PROJECT}'); await tick(800); return { project: S().project?.path, objects: S().model?.objects.length }`))); continue }
  if (scenes[key]) { await write(scenes[key]); continue }
  if (key === 'reload') { await run(`location.reload()`).catch(() => {}); await sleep(2500); await frame(); await sleep(300); console.log('reloaded'); continue }
  if (key === 'frame') { await frame(); await sleep(300); console.log('frame'); continue }
  console.log(key, JSON.stringify(await run(G[key])))
}
ws.close()
