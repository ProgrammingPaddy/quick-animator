// The preset preview in color, spaces as characters, the razor on class animations and formula paths with notices, the paint tool, and the moved pin.
// Steps: reload open PREVIEW1 SPACES1 CLASSCUT1 FPATH1 PAINT1 PLACES1
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
const SPACES = ['t = Text({', '  x: 0,', '  y: 0,', "  text: 'Quick fox',", '  fontSize: 60,', '  until: 8,', '})', '', 't.fade({', '  opacity: [0, 1],', "  by: 'char',", '  stagger: 0.1,', '  at: 1,', '  duration: 0.2,', '})', '', 't.char(5).to({', "  fill: '#ff0000',", '  at: 4,', '  duration: 0.5,', '})', ''].join('\n')
const CLASSCUT = ['a = Rect({', '  x: -300,', '  y: 0,', '  width: 100,', '  height: 60,', "  class: 'bars',", '  until: 6,', '})', '', 'b = Rect({', '  x: 300,', '  y: 0,', '  width: 100,', '  height: 60,', "  class: 'bars',", '  until: 6,', '})', '', "slide = all('bars').move({", '  x: 100,', '  relative: true,', '  at: 1,', '  duration: 1,', '})', ''].join('\n')
const FPATH = ['b = Rect({', '  x: 0,', '  y: 0,', '  width: 100,', '  height: 60,', '  until: 6,', '})', '', 'c = Rect({', '  x: 0,', '  y: 200,', '  width: 100,', '  height: 60,', '  until: 6,', '})', '', 'b.path({', '  shape: (p) => [p * 300, Math.sin(p * 6) * 50],', '  at: 1,', '  duration: 2,', '})', '', 'c.to({', '  x: 200,', '  at: 1,', '  duration: 1,', '  hold: 1,', '  return: 0.5,', '})', ''].join('\n')
const PAINT = ['b = Rect({', '  x: 0,', '  y: 0,', '  width: 200,', '  height: 120,', "  fill: '#4f8cff',", '  until: 6,', '})', '', 'b.to({', "  fill: '#00ff00',", '  at: 2,', '  duration: 1,', '})', ''].join('\n')

const G = {
  // The preset preview's model shows the color changing (D291): the demo's fill differs between its start and its middle.
  PREVIEW1: `const pre = await import('/src/project/presets.ts'); const ev = await import('/src/model/evaluate.ts'); const demo = pre.presetDemo('colorChange', 'red'); const m = ev.evaluateScene(demo.source, 60).model; const o = m.objects[0]; return { start: smp.valueAt(m, o, 'fill', 0), mid: smp.valueAt(m, o, 'fill', 0.6), rainbow: smp.valueAt(ev.evaluateScene(pre.presetDemo('colorChange', 'rainbow').source, 60).model, ev.evaluateScene(pre.presetDemo('colorChange', 'rainbow').source, 60).model.objects[0], 'fill', 1.5), err: S().error }`,
  // Every character is a unit, spaces too (D289): the index is the text's, a space takes its turn, nothing of it shows, and the share counts the seen characters.
  SPACES1: `await setSource(${JSON.stringify(SPACES)}); S().select([]); S().setTime(0); await tick(400); const m = S().model; const textUrl = performance.getEntriesByType('resource').map(e => e.name).find(n => n.includes('/src/model/text.ts')) ?? '/src/model/text.ts'; const textMod = await import(textUrl); const layout = textMod.layoutOf(smp.textStyleAt(m, obj('t'), 0)); const chars = layout.units.char.map(u => u.text); const states = (t) => smp.textUnitStates(m, obj('t'), t, layout); const s17 = states(1.75); const share = +smp.visibleShareAt(m, obj('t'), 1.45).toFixed(3); const seen = s17 ? s17.filter((_, i) => chars[i] !== ' ') : []; return { chars, count: textMod.unitCount('a b\\nc', 'char'), end0: obj('t').actions[0].end, spaceAt5: chars[5] === ' ', spaceFill: states(4.3)?.[5]?.fill ?? null, fAt6: states(4.3)?.[6]?.fill ?? null, share, warnings: m.warnings, err: S().error }`,
  // A class animation is cut as one (D290): both pieces keep the values, every member its own course, the name on the first; through the razor on a member's derived clip too.
  CLASSCUT1: `await setSource(${JSON.stringify(CLASSCUT)}); S().select([]); S().setTime(0); await tick(400); const m0 = S().model; const sample = (model) => [1.25, 1.5, 1.75, 2, 3].map(t => [smp.valueAt(model, model.objects[0], 'x', t), smp.valueAt(model, model.objects[1], 'x', t)].map(v => Math.round(v * 100) / 100)); const before = sample(m0); const cut = ops.sliceClassAction(0, 1.5); await tick(300); const m1 = S().model; const after = sample(m1); const heads = S().source.match(/all\\('bars'\\)\\.move\\(/g)?.length; const named = /slide = all\\('bars'\\)\\.move\\(/.test(S().source); await setSource(${JSON.stringify(CLASSCUT)}); await tick(400); S().setTimelineTool('razor'); await tick(200); const bar = clipOf('a').querySelector('.clip.derived'); const r = bar.getBoundingClientRect(); const p = pps(); const x = r.left + p * 0.5; pe(bar, 'pointerdown', x, r.top + 8); await tick(); pe(bar, 'pointerup', x, r.top + 8); await tick(400); const viaRazor = { classActions: S().model.classActions.length, spans: S().model.classActions.map(c => [c.members[0].start, c.members[0].end]) }; S().setTimelineTool('select'); return { cut, same: JSON.stringify(before) === JSON.stringify(after), before, after, classActions: m1.classActions.length, heads, named, viaRazor, err: S().error }`,
  // A path from a formula is cut, the line kept on both pieces (D290); a cut at an edge or in a hold says why.
  FPATH1: `await setSource(${JSON.stringify(FPATH)}); S().select([]); S().setTime(0); await tick(400); const m0 = S().model; const sample = (model) => [1.5, 2, 2.5, 3].map(t => ['x', 'y'].map(a => Math.round(smp.valueAt(model, model.objects[0], a, t) * 100) / 100)); const before = sample(m0); const cut = ops.sliceAction('b', 0, 2); await tick(300); const after = sample(S().model); const pieces = obj('b').actions.map(a => [a.start, a.end]); S().setNotice(null); const atEdge = ops.sliceAction('c', 0, 1); const edgeNote = S().notice; S().setNotice(null); const inHold = ops.sliceAction('c', 0, 2.5); const holdNote = S().notice; S().setNotice(null); return { cut, same: JSON.stringify(before) === JSON.stringify(after), before, after, pieces, atEdge, edgeNote, inHold, holdNote, err: S().error }`,
  // Paint (D293): the declaration, the color change that has the say, or a new color change with Shift; and the tool's click in the preview.
  PAINT1: `await setSource(${JSON.stringify(PAINT)}); S().select([]); S().setTime(0); await tick(400); ops.paintFill('b', '#ff0000', 1); await tick(200); const decl = obj('b').attrs.fill; ops.paintFill('b', '#0000ff', 2.5); await tick(200); const change = obj('b').actions[0].changes.fill; const declStill = obj('b').attrs.fill; ops.beginFill('b', '#123456', 'start', 4); await tick(300); const added = obj('b').actions.length === 2 ? { fill: obj('b').actions[1].changes.fill, start: obj('b').actions[1].start, end: obj('b').actions[1].end, selected: S().selectedActions } : null; S().setTool('paint'); S().setTime(1); await tick(300); const bar = document.querySelector('.paint-bar'); const well = bar?.querySelector('.color-swatch'); const hex = (el) => el ? '#' + (el.style.backgroundColor.match(/[0-9]+/g) ?? []).slice(0, 3).map(n => Number(n).toString(16).padStart(2, '0')).join('') : null; const g = geom(); pe(g.el, 'pointerdown', g.sx(0), g.sy(0)); await tick(); pe(g.el, 'pointerup', g.sx(0), g.sy(0)); await tick(300); const clicked = obj('b').attrs.fill; const hint = document.querySelector('.preview-hud .hint')?.textContent ?? null; S().setTool('select'); return { decl, change, declStill, added, bar: !!bar, well: hex(well), clicked, swatches: bar?.querySelectorAll('.swatch').length ?? null, hint, err: S().error }`,
  // The pin and the chain sit with the preview's options (D292); the file menu's shortcuts are dim; the tool and razor tooltips are short.
  PLACES1: `S().setTool('select'); S().select([]); await tick(200); const tools = document.querySelector('.preview-tools'); const pin = tools?.querySelector('.preview-toggle')?.textContent ?? null; const inToolbar = !!document.querySelector('.preview-toolbar .preview-toggle'); const clipTitle = clipOf('b')?.querySelector('.oclip-title'); if (clipTitle) { const cr = clipTitle.getBoundingClientRect(); clipTitle.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: cr.left + 20, clientY: cr.top + 8 })) } await tick(300); const kw = document.querySelector('.context-menu .keyword'); const kwStyle = kw ? { weight: getComputedStyle(kw).fontWeight, color: getComputedStyle(kw).color } : null; key('keydown', 'Escape'); await tick(200); return { pin, inToolbar, kwStyle, pathTitle: document.querySelector('[aria-label="Path"]')?.title ?? null, paintTitle: document.querySelector('[aria-label="Paint"]')?.title ?? null, razorTitle: [...document.querySelectorAll('button')].find(b => b.title?.startsWith('Razor'))?.title ?? null, err: S().error }`,
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
