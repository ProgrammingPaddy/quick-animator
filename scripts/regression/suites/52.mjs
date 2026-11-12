// A point tied to the scene, text styled with fonts from the project, animation by character, word, and line, the text presets, and the Selected pane for both.
// Steps: reload open AT1 TEXT1 UNITS1 FONTS1 PRESETTEXT1 NOWBY1
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
// The module the app itself runs, by the address it was loaded from: after a hot update a module asked for by its plain address is a second one, which for the text's has no canvas to measure with and only estimates.
const live = (path) => import(performance.getEntriesByType('resource').map((e) => e.name).filter((n) => n.split('?')[0].endsWith(path)).pop() ?? path);
${body} })()`
  const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true, timeout: 120000 })
  if (r.exceptionDetails) return { EXCEPTION: r.exceptionDetails.exception?.description ?? r.exceptionDetails.text }
  return r.result.value
}
const write = async (text) => { await sleep(1500); writeFileSync(SCRATCH, text); await sleep(1500); await frame(); await sleep(200) }
const TIED = ['c = Circle({', '  x: 300,', '  y: 200,', '  radius: 20,', '})', '', 's = Shape({', '  x: 100,', '  y: 50,', '  rotation: 30,', '  points: [', '    [-50, -50],', '    [50, -50],', '    at(300, 200),', '  ],', "  fill: '#4f8cff',", '})', '', 'l = Shape({', '  x: 0,', '  y: 0,', '  points: () => [[-50, -50], [50, -50], at(c.x, c.y)],', "  fill: '#10b981',", '})', ''].join('\n')
const TEXT = ['t = Text({', '  x: 0,', '  y: 0,', "  text: 'Hello there\\nWorld',", '  fontSize: 60,', "  align: 'right',", '  lineHeight: 1.5,', '  letterSpacing: 4,', '})', ''].join('\n')
const UNITS = ['t = Text({', '  x: 0,', '  y: 0,', "  text: 'ab cd',", '  fontSize: 60,', '  until: 4,', '})', '', 't.fade({', '  opacity: [0, 1],', "  by: 'char',", '  stagger: 0.1,', '  at: 1,', '  duration: 0.5,', '})', ''].join('\n')
const FONTS = ['t = Text({', '  x: 0,', '  y: 100,', "  text: 'Hello',", '  fontSize: 60,', "  font: 'Testfont',", '})', '', 'u = Text({', '  x: 0,', '  y: -100,', "  text: 'Hello',", '  fontSize: 60,', '})', ''].join('\n')
const PRESET = ['t = Text({', '  x: 0,', '  y: 0,', "  text: 'Rise by word now',", '  fontSize: 60,', '  until: 4,', '})', '', 'r = Rect({', '  x: 0,', '  y: -300,', '  width: 100,', '  height: 60,', '  until: 4,', '})', ''].join('\n')

const G = {
  // A point tied to the scene (D266): drawn where it says whatever the shape's x, y, and rotation; moved by the Shape tool, written back as at(x, y); a linked one follows what it names.
  AT1: `await setSource(${JSON.stringify(TIED)}); S().select([]); S().setTime(0); await tick(300); const w = (n) => smp.shapeWorldPoints(S().model, obj(n), 0).map(p => [Math.round(p.x * 100) / 100, Math.round(p.y * 100) / 100]); const before = { s: w('s'), l: w('l') }; ops.setObjectProp('s', 'rotation', 90); await tick(200); const turned = w('s'); ops.setShapePoints('s', [{ index: 2, world: { x: 400, y: 250 } }]); await tick(200); const written = { src: S().source.includes('at(400, 250)'), third: w('s')[2], first: w('s')[0] }; ops.setObjectProp('c', 'x', 500); await tick(200); const follows = w('l')[2]; return { before, turned, written, follows, warnings: S().model.warnings.length, err: S().error }`,
  // A Text styled (D267): two lines set right, a line height and a letter spacing, measured as laid out, its units counted.
  TEXT1: `await setSource(${JSON.stringify(TEXT)}); S().select([]); S().setTime(0); await tick(300); const m = S().model; const text = await live('/src/model/text.ts'); const style = smp.textStyleAt(m, obj('t'), 0); const layout = text.layoutOf(style); const bounds = smp.ownBounds(m, obj('t'), 0); const lefts = layout.lines.map(l => Math.round(l.left)); const widths = layout.lines.map(l => Math.round(l.width)); const spacingOff = text.layoutOf({ ...style, letterSpacing: 0 }).width; const counts = { char: text.unitCount(style.text, 'char'), word: text.unitCount(style.text, 'word'), line: text.unitCount(style.text, 'line') }; return { style: { align: style.align, lineHeight: style.lineHeight, letterSpacing: style.letterSpacing, lines: layout.lines.length }, bounds: { w: Math.round(bounds.width), h: Math.round(bounds.height) }, lefts, widths, rightAligned: lefts[1] > lefts[0] && Math.abs(lefts[1] + widths[1] - (lefts[0] + widths[0])) < 1, spacingWider: layout.width > spacingOff, lineGap: Math.round(layout.lines[1].baseline - layout.lines[0].baseline), counts, chars: layout.units.char.length, words: layout.units.word.length, err: S().error }`,
  // A fade by character (D268): the action spans every unit, the object's own opacity is untouched, the characters hold their start before their turn and fade in one after another; the clip says by char; the razor leaves it.
  UNITS1: `await setSource(${JSON.stringify(UNITS)}); S().select([]); S().setTime(0); await tick(300); const m = S().model; const text = await live('/src/model/text.ts'); const a = obj('t').actions[0]; const layout = text.layoutOf(smp.textStyleAt(m, obj('t'), 1.25)); const states = (t) => smp.textUnitStates(m, obj('t'), t, layout)?.map(s => Math.round(s.opacity * 1000) / 1000) ?? null; const label = clipOf('t').querySelector('.clip .label')?.textContent; return { span: [a.start, a.end], objOpacity: smp.valueAt(m, obj('t'), 'opacity', 1.4), before: states(0.5), at125: states(1.25), at2: states(2), defining: smp.definingAction(obj('t'), 'opacity', 1.4)?.verb ?? null, label, slice: ops.sliceAction('t', 0, 1.4), warnings: S().model.warnings, err: S().error }`,
  // A font from the project's assets/fonts folder (D267): loaded under its file name, measured differently from the system font, and offered in the Selected pane's list.
  FONTS1: `await setSource(${JSON.stringify(FONTS)}); S().select([]); S().setTime(0); await tick(300); const m = S().model; const check = document.fonts.check('16px Testfont'); const fonts = [...S().fonts]; const text = await live('/src/model/text.ts'); const wT = text.layoutOf(smp.textStyleAt(m, obj('t'), 0)).width; const wU = text.layoutOf(smp.textStyleAt(m, obj('u'), 0)).width; S().select(['t']); await tick(400); const input = rowOf('font')?.querySelector('input'); const list = input?.getAttribute('role') ?? null; input?.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true })); await tick(150); const options = [...document.querySelectorAll('.now-values .font-list li')].map(o => o.textContent); input?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); await tick(100); return { check, fonts, widths: [Math.round(wT), Math.round(wU)], differ: Math.abs(wT - wU) > 1, list, hasTestfont: options.includes('Testfont'), systemCount: S().systemFonts.length, err: S().error }`,
  // The text presets (D268): Rise by word on a Text writes a to by word with its stagger and spans every word; on a Rect it writes nothing; the pane lists them under Text; the demo shows on a Text and lasts the whole run.
  PRESETTEXT1: `await setSource(${JSON.stringify(PRESET)}); S().select([]); S().setTime(0); await tick(300); const pre = await import('/src/project/presets.ts'); const textMod = await import('/src/model/text.ts'); pre.applyAnimationPreset('riseByWord', undefined, [{ object: 't', time: null }, { object: 'r', time: null }]); await tick(300); const a = obj('t').actions[0]; const src = S().source; const family = [...document.querySelectorAll('.presets-section.sub')].find(s => s.querySelector('.presets-title').textContent.includes('Text')); const rows = family ? [...family.querySelectorAll('.preset-row .name')].map(n => n.textContent.trim()) : []; const demo = pre.presetDemo('typeOn', undefined); const ev = await import('/src/model/evaluate.ts'); const dm = ev.evaluateScene(demo.source, 60).model; return { tActs: acts('t').length, rActs: acts('r').length, by: a?.timing.by, stagger: a?.timing.stagger, span: a ? [a.start, a.end] : null, words: textMod.unitCount(obj('t').attrs.text, 'word'), src: /by: 'word',\\n\\s+stagger: 0.08,/.test(src), rows, demo: { kind: dm?.objects[0]?.className, length: Math.round(demo.length * 100) / 100, end: dm?.actions[0]?.end, warnings: dm?.warnings }, err: S().error }`,
  // The Selected pane for a Text (D267, D268): its words in a box of lines, align as a list, the font with the families; its animation's by as a list with the stagger beside it, and choosing a unit writes it.
  NOWBY1: `await setSource(${JSON.stringify(UNITS)}); S().select([]); S().setTime(0); await tick(300); S().select(['t']); await tick(250); const area = rowOf('text')?.querySelector('textarea'); const alignSel = rowOf('align')?.querySelector('select'); const alignOptions = alignSel ? [...alignSel.options].map(o => o.value) : []; const fontList = rowOf('font')?.querySelector('input')?.getAttribute('role'); S().selectAction('t', 0); await tick(250); const bySel = rowOf('by')?.querySelector('select'); const byValue = bySel?.value; const staggerRow = !!rowOf('stagger'); const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set; setter.call(bySel, 'word'); bySel.dispatchEvent(new Event('change', { bubbles: true })); await tick(250); const after = { by: obj('t').actions[0].timing.by, src: S().source.includes("by: 'word'"), span: [obj('t').actions[0].start, obj('t').actions[0].end] }; return { area: !!area, rows: area?.rows, alignOptions, fontList, byValue, staggerRow, after, err: S().error }`,
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
