// The second look at the lanes: the fade start handle extends, live levels, the Classes lane, anchored marks, menu wording, the Add submenu, the Add object tool.
// Steps: reload open fade FADEL1 grp LEVEL2 cls CLASSLANE1 cls CLASSFADE1 grp ANCHOR1 grp MENU1 grp TOOL1 OFF
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
const key = (type, k, extra = {}) => window.dispatchEvent(new KeyboardEvent(type, { key: k, code: k === 'Shift' ? 'ShiftLeft' : k, bubbles: true, cancelable: true, ...extra }));
const obj = (name) => S().model.objects.find(o => o.name === name);
const acts = (name) => obj(name).actions.map(a => [a.verb, a.start, a.end]);
const order = () => S().model.objects.map(o => o.name);
const clipOf = (name) => document.querySelector('.oclip[data-object="' + name + '"]');
const setSource = async (text) => { const ed = window.__quickAnimator.getEditor(); ed.dispatch({ changes: { from: 0, to: ed.state.doc.length, insert: text } }); await tick(400) };
const dragEl = async (el, dxPx, dyPx = 0, steps = 4) => { const r = el.getBoundingClientRect(); const x = r.left + r.width / 2, y = r.top + r.height / 2; pe(el, 'pointerdown', x, y); pe(el, 'pointermove', x + (dyPx ? 0 : 4), y + (dyPx ? 4 * Math.sign(dyPx) : 0)); for (let i = 1; i <= steps; i++) pe(el, 'pointermove', x + dxPx * i / steps, y + dyPx * i / steps); pe(el, 'pointerup', x + dxPx, y + dyPx); await tick(100) };
const geom = () => { const el = document.querySelector('.preview'); const r = el.getBoundingClientRect(); const zoom = Math.max(Math.min((r.width - 80) / 1920, (r.height - 80) / 1080), 0.02); const sx = (wx) => r.left + r.width / 2 + wx * zoom; const sy = (wy) => r.top + r.height / 2 - wy * zoom; return { el, r, zoom, sx, sy } };
const menuItems = () => (S().contextMenu?.items ?? []).map(i => ({ label: i.label, keyword: i.keyword, children: i.children?.map(c => c.label) }));
const pps = () => { const a = document.querySelectorAll('.tl-ruler .tick'); if (a.length < 2) return null; const t0 = parseFloat(a[0].textContent), t1 = parseFloat(a[1].textContent); return (a[1].getBoundingClientRect().left - a[0].getBoundingClientRect().left) / (t1 - t0) };
${body} })()`
  const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true, timeout: 120000 })
  if (r.exceptionDetails) return { EXCEPTION: r.exceptionDetails.exception?.description ?? r.exceptionDetails.text }
  return r.result.value
}
const write = async (text) => { await sleep(1500); writeFileSync(SCRATCH, text); await sleep(1500); await frame(); await sleep(200) }

const FADE = ['a = Rect({', '  x: -300,', '  y: 0,', '  width: 200,', '  height: 100,', '  until: 4,', '})', '', 'a.fade({', '  opacity: 0.2,', '  at: 1,', '  duration: 0.5,', '})', ''].join('\n')

const GRP = ['a = Rect({', '  x: -300,', '  y: 0,', '  width: 200,', '  height: 100,', '  fill: \'#4f8cff\',', '  until: 3,', '})', '', 'b = Circle({', '  x: 300,', '  y: 0,', '  radius: 60,', '  fill: \'#10b981\',', '  at: 1,', '})', '', 'g = Group({', '  members: \'a b\',', '})', '', 'g.move({', '  x: 100,', '  at: 2,', '  duration: 2,', '})', ''].join('\n')

const CLS = ['a = Rect({', '  x: -300,', '  y: 0,', '  width: 200,', '  height: 100,', '  class: \'bars\',', '  until: 4,', '})', '', 'b = Rect({', '  x: 300,', '  y: 0,', '  width: 200,', '  height: 100,', '  class: \'bars\',', '  at: 0.5,', '  until: 4,', '})', '', 'c = Circle({', '  x: 0,', '  y: 300,', '  radius: 50,', '})', '', 'rise = all(\'bars\').fade({', '  opacity: 0,', '  at: 1,', '  duration: 1,', '})', ''].join('\n')

const G = {
  // The fade's start handle dragged left extends the fade and keeps its end; dragged right it shortens it.
  FADEL1: `await tick(300); const p = pps(); const h = () => clipOf('a').querySelector('.opacity-handle.start'); const before = acts('a'); await dragEl(h(), -p * 0.5); const left = acts('a'); await dragEl(h(), p * 0.8); return { before, left, right: acts('a'), err: S().error }`,
  // Dragging a's title up past b's middle moves a above b at once, with no drop line; back down returns it; one undo step for the whole drag.
  LEVEL2: `await tick(300); const top = (n) => clipOf(n).getBoundingClientRect().top; const mid = (n) => { const rb = clipOf(n).getBoundingClientRect(); return rb.top + rb.height / 2 }; const title = clipOf('a').querySelector('.oclip-title'); const r = title.getBoundingClientRect(); const x = r.left + r.width / 2, y = r.top + r.height / 2; const o0 = order(); const lift = mid('a') - mid('b') + 12; pe(title, 'pointerdown', x, y); pe(title, 'pointermove', x, y - 4); pe(title, 'pointermove', x, y - lift); await tick(200); const up = { order: order(), line: !!document.querySelector('.tl-drop-line'), aAbove: top('a') < top('b') }; pe(title, 'pointermove', x, y + 40); await tick(200); const down = { order: order() }; pe(title, 'pointermove', x, y - lift); await tick(200); pe(title, 'pointerup', x, y - lift); await tick(250); const released = order(); document.querySelector('.titlebar button[title^="Undo"]').click(); await tick(300); return { o0, up, down, released, undone: order(), err: S().error }`,
  // The Classes lane: a clip per class spanning its members, its action inside with fade handles, members in its title; member clips show the class's fade dashed and name their classes.
  CLASSLANE1: `await tick(300); const lanes = [...document.querySelectorAll('.tl-row.lane')].map(l => l.dataset.lane); const cc = document.querySelector('.oclip.class[data-class="bars"]'); const members = cc?.querySelector('.members')?.textContent; const bars = cc ? [...cc.querySelectorAll('.clip')].map(e => e.textContent) : null; const handles = cc?.querySelectorAll('.opacity-handle').length; const aClasses = clipOf('a').querySelector('.classes')?.textContent; const cClasses = clipOf('c').querySelector('.classes'); const aDerived = clipOf('a').querySelectorAll('.clip.derived').length; const span = [cc?.dataset.start, cc?.dataset.end]; cc.querySelector('.oclip-title').click(); await tick(100); return { lanes, members, bars, handles, aClasses, cClasses: !!cClasses, aDerived, span, selectedAfterTitleClick: S().selection, err: S().error }`,
  // The class fade's start handle extends the class fade for every member, keeping its end.
  CLASSFADE1: `await tick(300); const p = pps(); const h = document.querySelector('.oclip.class .opacity-handle.start'); const before = acts('a'); await dragEl(h, -p * 0.5); return { before, after: { a: acts('a'), b: acts('b') }, err: S().error }`,
  // An anchored object wears a diamond in the preview, says so on its clip, and in the object pane.
  ANCHOR1: `S().setAnchored('a', true); await tick(300); const r = window.__quickAnimator.getRenderer(); const mark = r.anchorMarks[0]; const f = r.frameOf('a'); const res = { marks: r.anchorMarks.length, visible: mark?.group.visible, at: mark ? [mark.group.position.x, mark.group.position.y] : null, frame: f ? [f.x, f.y] : null, clipSays: !!clipOf('a').querySelector('.anchored'), paneBadge: !!document.querySelector('.objects .badge.anchor') }; S().setAnchored('a', false); await tick(200); res.after = { visible: r.anchorMarks[0]?.group.visible, clipSays: !!clipOf('a').querySelector('.anchored') }; return res`,
  // Menus: the lane's empty space and the preview's empty space offer Add with the kinds beneath; an object's menu says Rename, Classes, Begin at, End at.
  MENU1: `await tick(300); const track = document.querySelector('.tl-row.lane[data-lane=objects] .tl-track'); const tr = track.getBoundingClientRect(); me(track, 'contextmenu', tr.left + 40, tr.bottom - 4); await tick(100); const lane = menuItems(); S().closeMenu?.(); me(clipOf('a'), 'contextmenu', clipOf('a').getBoundingClientRect().left + 30, clipOf('a').getBoundingClientRect().top + 8); await tick(100); const clip = menuItems().map(i => i.label); S().closeMenu?.(); const g = geom(); me(g.el, 'contextmenu', g.sx(0), g.sy(-450)); await tick(100); const blank = menuItems(); S().closeMenu?.(); me(g.el, 'contextmenu', g.sx(-300), g.sy(0)); await tick(100); const object = menuItems().map(i => i.label + (i.keyword ? ' ' + i.keyword : '')); S().closeMenu?.(); return { lane, clip, blank, object }`,
  // The Add object tool: on, with a kind picked, each click places one and the tool stays on; Escape puts it away.
  TOOL1: `S().select([]); S().setTool('object'); S().setAddKind('Circle'); await tick(200); const kinds = [...document.querySelectorAll('.preview-toolbar .preview-modes button')].map(b => [b.textContent, b.classList.contains('active')]); const g = geom(); const n0 = S().model.objects.length; pe(g.el, 'pointerdown', g.sx(-500), g.sy(-300)); pe(g.el, 'pointerup', g.sx(-500), g.sy(-300)); await tick(150); const first = S().model.objects[S().model.objects.length - 1]; const toolAfterOne = S().tool; pe(g.el, 'pointerdown', g.sx(500), g.sy(-300)); pe(g.el, 'pointerup', g.sx(500), g.sy(-300)); await tick(150); const n2 = S().model.objects.length; key('keydown', 'Escape'); await tick(100); const toolAfterEscape = S().tool; const made = S().model.objects.slice(n0).map(o => [o.className, o.attrs.x, o.attrs.y]); ops.deleteObjects(S().model.objects.slice(n0).map(o => o.name)); await tick(); return { kinds, first: [first.className, first.attrs.x, first.attrs.y], toolAfterOne, n2: n2 - n0, toolAfterEscape, made, err: S().error }`,
  OFF: `S().setTool('select'); if (S().collide) S().setCollide(false); await tick(); return { tool: S().tool }`,
}
const scenes = { fade: FADE, grp: GRP, cls: CLS }
for (const key of process.argv.slice(2)) {
  if (key === 'open') { console.log('open', JSON.stringify(await run(`await window.__quickAnimator.openProject('${PROJECT}'); await tick(800); return { project: S().project?.path, objects: S().model?.objects.length }`))); continue }
  if (scenes[key]) { await write(scenes[key]); continue }
  if (key === 'reload') { await run(`location.reload()`).catch(() => {}); await sleep(2500); await frame(); await sleep(300); console.log('reloaded'); continue }
  if (key === 'frame') { await frame(); await sleep(300); console.log('frame'); continue }
  console.log(key, JSON.stringify(await run(G[key])))
}
ws.close()
