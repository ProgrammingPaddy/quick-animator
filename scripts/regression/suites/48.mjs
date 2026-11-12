// Deselecting on empty space, the timeline's edges, hotkeys rebound and their tab, and the top bar.
// Steps: reload open DESELECT1 EDGES1 HOTKEY1 PREFS1 TITLEBAR1
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
const POLY = ['poly = Shape({', '  x: 0,', '  y: 0,', '  curves: `', '    M -100 -100', '    L 100 -100', '    L 100 100', '    L -100 100', '    Z', '  `,', "  fill: '#4f8cff',", '})', ''].join('\n')
const MOVES = ['b = Rect({', '  x: 0,', '  y: 0,', '  width: 100,', '  height: 60,', '  until: 3,', '})', '', 'b.move({', '  x: 300,', '  at: 1,', '  duration: 1,', '})', '', 'b.move({', '  x: 0,', '  at: 2.5,', '  duration: 0.5,', '})', ''].join('\n')
const KEY = `const press = (code, extra = {}) => window.dispatchEvent(new KeyboardEvent('keydown', { code, key: code.replace('Key', '').toLowerCase(), bubbles: true, cancelable: true, ...extra }));`

const G = {
  // A click on empty space in the Shape tool's Edit mode deselects the shape (D236 revised).
  DESELECT1: `await setSource(${JSON.stringify(POLY)}); S().setTool('select'); S().select(['poly']); S().setTime(0); S().setTool('shape'); await tick(250); const g = geom(); const before = { mode: S().shapeMode, selected: [...S().selection] }; S().setPathPoints([0]); await tick(100); pe(g.el, 'pointerdown', g.sx(-400), g.sy(-400)); await tick(30); pe(g.el, 'pointerup', g.sx(-400), g.sy(-400)); await tick(200); const after = { selected: [...S().selection], points: [...S().pathPoints], tool: S().tool }; S().setTool('select'); return { before, after, err: S().error }`,
  // The edges of the timeline (D259): every object's and animation's start and end; the playhead goes to the next or the previous, whatever is selected, from the menu, the Selected pane, or the keys.
  EDGES1: `await setSource(${JSON.stringify(MOVES)}); S().select([]); S().setTime(0); S().setTool('select'); await tick(300); ${KEY} const edges = ops.timelineEdges(S().model); const steps = []; for (let i = 0; i < 6; i++) { steps.push(ops.jumpToEdge(1)) } S().setTime(2.2); const back = ops.jumpToEdge(-1); S().setTime(1.5); press('ArrowRight', { ctrlKey: true }); await tick(60); const keyNext = S().time; press('ArrowLeft', { ctrlKey: true }); await tick(60); const keyPrev = S().time; S().selectAction('b', 0); await tick(200); const links = [...document.querySelectorAll('.now-head .time-link')].map(b => b.textContent.trim()); document.querySelectorAll('.now-head .time-link')[1]?.click(); await tick(100); const linkEnd = S().time; const clip = document.querySelector('.aclip, [class*="clip"][data-index]'); S().select([]); return { edges, steps, back, keyNext, keyPrev, links, linkEnd, err: S().error }`,
  // A hotkey rebound in the preferences answers to its new key and no longer to the old one (D260).
  HOTKEY1: `await setSource(${JSON.stringify(MOVES)}); S().select([]); S().setTime(0); S().setPlaying(false); ${KEY} press('Space'); await tick(60); const spacePlays = S().playing; S().setPlaying(false); S().setPrefs({ hotkeys: { play: ['P'] } }); await tick(60); press('Space'); await tick(60); const spaceAfter = S().playing; press('KeyP'); await tick(60); const pAfter = S().playing; S().setPlaying(false); S().setPrefs({ hotkeys: {} }); await tick(60); press('KeyP'); await tick(60); const pReset = S().playing; press('Space'); await tick(60); const spaceReset = S().playing; S().setPlaying(false); S().setTime(0); return { spacePlays, spaceAfter, pAfter, pReset, spaceReset, saved: JSON.parse(localStorage.getItem('quick-animator.prefs') || '{}').hotkeys, err: S().error }`,
  // The Hotkeys tab (D260): every hotkey listed by pane, a changed one with Reset, and a key already taken said beside both rows.
  PREFS1: `S().setPrefs({ hotkeys: { duplicate: ['Ctrl+A'] } }); S().setPrefsOpen(true); await tick(250); const tabs = [...document.querySelectorAll('.prefs-tabs button')].map(b => b.textContent.trim()); [...document.querySelectorAll('.prefs-tabs button')].find(b => b.textContent.trim() === 'Hotkeys')?.click(); await tick(200); const rows = [...document.querySelectorAll('.hotkey-row')]; const scopes = [...document.querySelectorAll('.hotkeys-scope')].map(e => e.textContent); const conflicts = rows.filter(r => r.classList.contains('conflict')).map(r => [r.querySelector('.hotkey-label').textContent, r.querySelector('.hotkey-conflict').textContent]); const chips = rows.find(r => r.querySelector('.hotkey-label').textContent === 'Duplicate')?.querySelectorAll('.hotkey-chip').length; const resets = document.querySelectorAll('.hotkey-row .small').length; const fixed = rows.filter(r => r.querySelector('.hotkey-chip:disabled')).length; S().setPrefs({ hotkeys: {} }); S().setPrefsOpen(false); await tick(100); return { tabs, rowCount: rows.length, scopes, conflicts, chips, resets, fixed, err: S().error }`,
  // The top bar (D261): File drops down Open, New, Import, Export; undo and redo are arrows at the right.
  TITLEBAR1: `const actions = [...document.querySelectorAll('.titlebar-actions button')].map(b => b.textContent.trim()); const file = document.querySelector('.titlebar-actions .menu-button'); file?.click(); await tick(150); const items = [...document.querySelectorAll('.context-menu button')].map(b => b.textContent.replace(/\\s+/g, ' ').trim()); document.body.click(); await tick(80); const icons = [...document.querySelectorAll('.titlebar-right button.icon')].map(b => b.getAttribute('aria-label')); const titles = [...document.querySelectorAll('.titlebar-right button.icon')].map(b => b.getAttribute('title')); return { actions, items, icons, titles }`,
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
