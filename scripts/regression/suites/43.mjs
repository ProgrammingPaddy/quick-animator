// Points that fold, and the imported tag in place of a class.
// Steps: reload open FOLDPTS1 IMPORTED1 OFF
import { readFileSync, writeFileSync } from 'node:fs'

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
const SVG_TEXT = readFileSync(`${SP}/test-drawing.svg`, 'utf8')
const ONE_LINE = ['tri = Shape({', '  x: -300,', '  y: 0,', '  points: [[0, 60], [-60, -40], [60, -40]],', "  fill: '#4f8cff',", '})', '', 'box = Rect({', '  x: 200,', '  y: 0,', '  width: 100,', '  height: 60,', '})', ''].join('\n')

const G = {
  // Points fold: a placed Shape's points are written one per line and folded; a list written on one line folds between its brackets; a drawn shape's list is folded once it is closed; the list reads back and edits as before.
  FOLDPTS1: `await setSource(${JSON.stringify(ONE_LINE)}); S().select([]); S().setTime(0); await tick(200); const ed = await import(performance.getEntriesByType('resource').map(e => e.name).find(n => /\\/src\\/code\\/editor\\.ts(\\?|$)/.test(n)) ?? '/src/code/editor.ts'); const placeholders = () => document.querySelectorAll('.cm-foldPlaceholder').length; const before = placeholders(); ed.foldShapes(); await tick(150); const oneLine = { folded: placeholders(), gutter: !!document.querySelector('.cm-foldGutter') }; ops.addObject('Shape', 0, 200); await tick(300); const src = S().source; const placed = { multiline: /points: \\[\\n    \\[0, 50\\],\\n    \\[-60, -50\\],\\n    \\[60, -50\\],\\n  \\],/.test(src), folded: placeholders(), count: obj('shape1')?.attrs.points.length }; const g = geom(); const click = async (x, y) => { pe(g.el, 'pointerdown', g.sx(x), g.sy(y)); pe(g.el, 'pointerup', g.sx(x), g.sy(y)); await tick(150) }; S().setTool('shape'); S().setShapeMode('create'); await tick(100); await click(-500, 250); await click(-300, 250); await click(-300, 400); await click(-500, 250); await tick(200); const drawn = { closed: ops.isShapeClosed('shape2'), anchors: ops.shapeAnchorCount('shape2'), multiline: /shape2 = Shape\\(\\{[^}]*curves: .\\n\\s*M /.test(S().source), folded: placeholders() }; S().setShapeMode('edit'); S().select(['tri']); await tick(200); const w = smp.shapeWorldPoints(S().model, obj('tri'), 0); await path(g, [{ x: w[0].x, y: w[0].y }, { x: w[0].x, y: w[0].y + 40 }]); const edited = { points: obj('tri').attrs.points, oneLineKept: /points: \\[\\[0, 100\\], \\[-60, -40\\], \\[60, -40\\]\\]/.test(S().source) }; S().setTool('select'); S().select([]); return { before, oneLine, placed, drawn, edited, err: S().error }`,
  // The import's tag: every object and group says the file it came from, no class, the object pane shows an I with the file on hover, and its search finds them.
  IMPORTED1: `await setSource(${JSON.stringify(ONE_LINE)}); S().select([]); S().setTime(0); S().setObjectsView('type'); await tick(200); const n0 = S().model.objects.length; ops.importSvg(${JSON.stringify(SVG_TEXT)}, 'test-drawing', { x: 0, y: 0 }); await tick(500); const added = S().model.objects.slice(n0); const badges = [...document.querySelectorAll('.badge.imported')]; const search = document.querySelector('.objects-search'); await setInput(search, 'imported'); const found = [...document.querySelectorAll('.object-row .name')].map(el => el.textContent); await setInput(search, ''); S().select([]); S().setNotice(null); const classRows = document.querySelectorAll('.object-row.class-row').length; S().setObjectsView('layers'); return { imported: [...new Set(added.map(o => o.attrs.imported))], classes: [...new Set(added.map(o => o.attrs.class))], groups: added.filter(o => o.className === 'Group').map(o => o.attrs.imported), badges: badges.length, badgeTitle: badges[0]?.getAttribute('title'), classRows, found: found.length, foundSample: found.slice(0, 3), err: S().error }`,
  OFF: `S().select([]); S().setTool('select'); S().setTransformMode('all'); S().setPick('object'); if (S().collide) S().setCollide(false); S().setNotice(null); await tick(); return { tool: S().tool }`,
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
