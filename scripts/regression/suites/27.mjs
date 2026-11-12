// Snapping with guides, Shift over the timeline, Shift-wheel there, the chain, Active animations, free text in the Selected pane, the tiered links dialog.
// Steps: reload open link SNAP1 link SHIFTTL1 link WHEELTL1 chain CHAIN2 mix PANE3 mix FREE1 mix DLG3 OFF
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
  const expression = `(async () => { const ops = await import('/src/project/operations.ts'); const st = window.__quickAnimator.useStore; const S = () => st.getState(); const tick = (ms = 60) => new Promise(r => setTimeout(r, ms));
const pe = (el, type, x, y, extra = {}) => el.dispatchEvent(new PointerEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y, button: 0, buttons: type === 'pointerup' ? 0 : 1, pointerId: 1, isPrimary: true, pointerType: 'mouse', ...extra }));
const key = (type, k, extra = {}) => window.dispatchEvent(new KeyboardEvent(type, { key: k, code: k === 'Shift' ? 'ShiftLeft' : k, bubbles: true, cancelable: true, ...extra }));
const obj = (name) => S().model.objects.find(o => o.name === name);
const acts = (name) => obj(name).actions.map(a => [a.verb, a.start, a.end]);
const clipOf = (name) => document.querySelector('.oclip[data-object="' + name + '"]');
const setSource = async (text) => { const ed = window.__quickAnimator.getEditor(); ed.dispatch({ changes: { from: 0, to: ed.state.doc.length, insert: text } }); await tick(400) };
const setInput = async (el, value) => { const proto = Object.getPrototypeOf(el); const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set; if (setter) setter.call(el, value); else el.value = value; el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true })); await tick(60) };
const commit = async (el, value) => { el.focus(); await setInput(el, value); el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); el.blur(); await tick(200) };
const rowOf = (name) => [...document.querySelectorAll('.now-values tr')].find(tr => tr.querySelector('td.k')?.textContent === name);
const geom = () => { const el = document.querySelector('.preview'); const r = el.getBoundingClientRect(); const zoom = Math.max(Math.min((r.width - 80) / 1920, (r.height - 80) / 1080), 0.02); const sx = (wx) => r.left + r.width / 2 + wx * zoom; const sy = (wy) => r.top + r.height / 2 - wy * zoom; return { el, r, zoom, sx, sy } };
const pps = () => { const a = document.querySelectorAll('.tl-ruler .tick'); if (a.length < 2) return null; const t0 = parseFloat(a[0].textContent), t1 = parseFloat(a[1].textContent); return (a[1].getBoundingClientRect().left - a[0].getBoundingClientRect().left) / (t1 - t0) };
const hoverTimeline = () => { const tl = document.querySelector('.timeline'); tl.dispatchEvent(new PointerEvent('pointerover', { bubbles: true, pointerId: 1, pointerType: 'mouse' })); };
${body} })()`
  const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true, timeout: 120000 })
  if (r.exceptionDetails) return { EXCEPTION: r.exceptionDetails.exception?.description ?? r.exceptionDetails.text }
  return r.result.value
}
const write = async (text) => { await sleep(1500); writeFileSync(SCRATCH, text); await sleep(1500); await frame(); await sleep(200) }

const LINK = ['a = Rect({', '  x: -300,', '  y: 0,', '  width: 200,', '  height: 100,', '  until: 5,', '})', '', 'b = Rect({', '  x: 300,', '  y: 0,', '  width: 200,', '  height: 100,', '  at: 1,', '  until: 5,', '})', '', 'a.move({', '  x: 0,', '  at: 1,', '  duration: 1,', '})', '', 'b.move({', '  x: 0,', '  at: 3,', '  duration: 1,', '})', ''].join('\n')

const CHAIN = ['p = Rect({', '  x: -300,', '  y: 0,', '  width: 200,', '  height: 100,', '})', ''].join('\n')

const MIX = ['a = Rect({', '  x: -300,', '  y: 0,', '  width: 200,', '  height: 100,', '  fill: \'#4f8cff\',', '  class: \'bars\',', '  until: 3,', '})', '', 'b = Circle({', '  x: 300,', '  y: 0,', '  radius: 60,', '  fill: \'#10b981\',', '  at: 2,', '})', '', 'c = Text({', '  text: \'Hello\',', '  y: 300,', '  opacity: 0.5,', '})', '', 'a.move({', '  x: 0,', '  at: 1,', '  duration: 1,', '})', '', 'a.move({', '  y: 100,', '  at: 4,', '  duration: 1,', '})', ''].join('\n')

const G = {
  // Dragging b.move toward a.move's end snaps onto it from 0.05 s away, inside the 10 px reach (D185), and shows the guide while dragging; the guide goes on release.
  SNAP1: `if (!S().snap) S().toggleSnap(); await tick(200); const p = pps(); const clip = clipOf('b').querySelector('.clip'); const r = clip.getBoundingClientRect(); const x = r.left + 20, y = r.top + 8; pe(clip, 'pointerdown', x, y); pe(clip, 'pointermove', x - 4, y); pe(clip, 'pointermove', x - p * 0.95, y); await tick(150); const mid = { b: acts('b'), line: !!document.querySelector('.tl-snap-line') }; pe(clip, 'pointerup', x - p * 0.95, y); await tick(150); const after = { b: acts('b'), line: !!document.querySelector('.tl-snap-line') }; const title = clipOf('b').querySelector('.oclip-title'); const tr = title.getBoundingClientRect(); const tx = tr.left + tr.width / 2, ty = tr.top + tr.height / 2; pe(title, 'pointerdown', tx, ty); pe(title, 'pointermove', tx + 4, ty); pe(title, 'pointermove', tx - p * 0.92, ty); await tick(200); const lifeMid = { b: { at: obj('b').at, until: obj('b').until }, line: !!document.querySelector('.tl-snap-line') }; pe(title, 'pointerup', tx - p * 0.92, ty); await tick(200); return { pps: p, mid, after, lifeMid, err: S().error }`,
  // Shift held with the pointer over the timeline and an animation selected jumps the playhead to its end; releasing Shift returns it.
  SHIFTTL1: `const bar = clipOf('a').querySelector('.clip'); const r = bar.getBoundingClientRect(); pe(bar, 'pointerdown', r.left + 20, r.top + 8); pe(bar, 'pointerup', r.left + 20, r.top + 8); await tick(150); const t0 = S().time; hoverTimeline(); await tick(50); const hover = S().hoverTimeline; key('keydown', 'Shift'); await tick(100); const jumped = S().time; key('keyup', 'Shift'); await tick(100); return { t0, hover, jumped, restored: S().time, selected: S().selectedActions }`,
  // Shift and the wheel over the timeline lengthen the selected animation and put the playhead at its new end.
  WHEELTL1: `const bar = clipOf('a').querySelector('.clip'); const r = bar.getBoundingClientRect(); pe(bar, 'pointerdown', r.left + 20, r.top + 8); pe(bar, 'pointerup', r.left + 20, r.top + 8); await tick(150); hoverTimeline(); key('keydown', 'Shift'); await tick(100); const before = acts('a'); const grid = document.querySelector('.tl-grid'); const gr = grid.getBoundingClientRect(); for (let i = 0; i < 6; i++) grid.dispatchEvent(new WheelEvent('wheel', { bubbles: true, cancelable: true, deltaY: -100, shiftKey: true, clientX: gr.left + 400, clientY: gr.top + 100 })); await tick(200); const after = { a: acts('a'), time: S().time, step: S().wheelStep }; key('keyup', 'Shift'); await tick(100); return { before, after, restored: S().time }`,
  // Chain mode: with Shift held over the preview, two drags make two animations, the second starting where the first ends.
  CHAIN2: `S().setPin('start'); if (!S().chain) S().setChain(true); S().setTransformMode('move'); S().select([]); S().setTime(0); await tick(200); const g = geom(); pe(g.el, 'pointermove', g.sx(0), g.sy(-400)); key('keydown', 'Shift'); await tick(100); const lookahead = S().time; const drag = async (from, to) => { pe(g.el, 'pointerdown', g.sx(from.x), g.sy(from.y), { shiftKey: true }); pe(g.el, 'pointermove', g.sx(from.x) + 4, g.sy(from.y), { shiftKey: true }); for (let i = 1; i <= 4; i++) pe(g.el, 'pointermove', g.sx(from.x + (to.x - from.x) * i / 4), g.sy(from.y), { shiftKey: true }); pe(g.el, 'pointerup', g.sx(to.x), g.sy(to.y), { shiftKey: true }); await tick(200) }; await drag({ x: -300, y: 0 }, { x: -100, y: 0 }); const one = { acts: acts('p'), time: S().time }; await drag({ x: -100, y: 0 }, { x: 100, y: 0 }); const two = { acts: acts('p'), time: S().time, dest: obj('p').actions.map(a => a.changes.x) }; key('keyup', 'Shift'); await tick(100); S().setChain(false); return { lookahead, one, two, rest: S().time, err: S().error }`,
  // Active animations lists only the animations running at the playhead.
  PANE3: `S().setObjectsView('type'); S().setTime(1.5); await tick(200); const rows = () => [...document.querySelectorAll('.objects .action-row .name')].map(e => e.textContent); const all = rows(); const btn = (label) => [...document.querySelectorAll('.objects-filter button')].find(b => b.textContent === label); btn('Show Only Active').click(); await tick(150); const running = rows(); S().setTime(4.5); await tick(150); const later = rows(); btn('Show All').click(); await tick(100); S().setTime(0); S().setObjectsView('layers'); return { all, running, later, layout: document.querySelectorAll('.objects-tools-row').length }`,
  // Free text: a number field given code writes a link and shows what it comes to; a text field naming an object links too; a class list stays a list; a lifetime given a reference links.
  FREE1: `S().select(['b']); S().setTime(0); await tick(300); await commit(rowOf('x').querySelector('input'), 'a.x + 20'); const xRow = { src: S().source.includes('x: () => a.x + 20'), expr: rowOf('x').querySelector('.now-linked input')?.value, shown: rowOf('x').querySelector('.now-evaluated')?.textContent, linkButtons: document.querySelectorAll('.now-values .link-button').length }; await commit(rowOf('class').querySelector('input'), 'bars extra'); const cls = { classes: obj('b').classes, srcLinked: S().source.includes('class: () =>') }; S().select(['c']); await tick(200); const area = rowOf('text').querySelector('textarea'); area.focus(); await setInput(area, 'a.name'); area.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', ctrlKey: true, bubbles: true })); await tick(200); const text = { src: S().source.includes('text: () => a.name'), shown: rowOf('text').querySelector('.now-evaluated')?.textContent }; await commit(rowOf('at').querySelector('input'), 'a.end'); const life = { src: S().source.includes('at: a.end'), cAt: obj('c').at, shown: rowOf('at').querySelector('.now-evaluated')?.textContent }; return { xRow, cls, text, life, err: S().error }`,
  // The tiered dialog: opened on b's x, the slot is x; objects open to their number attributes; picking a's x writes the link; Unlink keeps the number.
  DLG3: `S().openLinksDialog({ object: 'b', key: 'x' }); await tick(200); const dlg = document.querySelector('.links-dialog'); const slot = dlg.querySelector('.links-slot.active .k')?.textContent; const rows = [...dlg.querySelectorAll('.links-row .links-what')].map(e => e.textContent.replace(/\\s+/g, ' ').trim()); const aRow = [...dlg.querySelectorAll('.links-row')].find(r => r.textContent.includes(' a ') || r.querySelector('.links-what').textContent.includes('a Rect')); aRow.querySelector('.links-what').click(); await tick(100); const parts = [...aRow.querySelectorAll('.links-parts button')].map(b => b.textContent); [...aRow.querySelectorAll('.links-parts button')].find(b => b.textContent === 'x').click(); await tick(250); const linked = { src: S().source.includes('x: () => a.x'), current: dlg.querySelector('.links-slot.active .v')?.textContent }; dlg.querySelector('.links-slot.active button').click(); await tick(250); const unlinked = { src: /x: -300,/.test(S().source), bx: obj('b').attrs.x }; dlg.querySelector('.links-slot input[type=radio]').click(); await tick(100); const timeRows = [...dlg.querySelectorAll('.links-row .links-what')].map(e => e.textContent.replace(/\\s+/g, ' ').trim()); dlg.querySelector('.dialog-actions button').click(); await tick(100); return { slot, rows, parts, linked, unlinked, timeRows, err: S().error }`,
  OFF: `S().select([]); S().setTool('select'); if (S().chain) S().setChain(false); await tick(); return { tool: S().tool }`,
}
const scenes = { link: LINK, chain: CHAIN, mix: MIX }
for (const key of process.argv.slice(2)) {
  if (key === 'open') { console.log('open', JSON.stringify(await run(`await window.__quickAnimator.openProject('${PROJECT}'); await tick(800); return { project: S().project?.path, objects: S().model?.objects.length }`))); continue }
  if (scenes[key]) { await write(scenes[key]); continue }
  if (key === 'reload') { await run(`location.reload()`).catch(() => {}); await sleep(2500); await frame(); await sleep(300); console.log('reloaded'); continue }
  if (key === 'frame') { await frame(); await sleep(300); console.log('frame'); continue }
  console.log(key, JSON.stringify(await run(G[key])))
}
ws.close()
