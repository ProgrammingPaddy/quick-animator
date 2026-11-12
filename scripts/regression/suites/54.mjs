// Kerning in per-character layout, the frame tolerance, frames in code with the hints, the ease as an envelope, the slot machine, and the preset families.
// Steps: reload open KERN1 TOL1 FRAMES1 HINTS1 ENVELOPE1 SLOT2 FAMILIES1
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
const KERN = ['t = Text({', '  x: 0,', '  y: 0,', "  text: 'AVAWay To',", '  fontSize: 80,', "  font: 'Georgia',", '})', '', 'u = Text({', '  x: 0,', '  y: 200,', "  text: 'AVAWay To',", '  fontSize: 80,', "  font: 'Georgia',", '  letterSpacing: 6,', '})', ''].join('\n')
const TOL = ['b = Rect({', '  x: 0,', '  y: 0,', '  width: 100,', '  height: 60,', '  at: 0.0167,', '  until: 0.05,', '})', '', 'c = Rect({', '  x: 300,', '  y: 0,', '  width: 100,', '  height: 60,', '})', '', 'c.move({', '  x: 500,', '  at: 0.0167,', '  duration: 1,', "  ease: 'linear',", '})', ''].join('\n')
const FRAMES = ['b = Rect({', '  x: 0,', '  y: 0,', '  width: 100,', '  height: 60,', '  until: frames(240),', '})', '', 'b.move({', '  x: 300,', '  at: frames(30),', '  duration: frames(60),', '})', ''].join('\n')
const ENV = ['b = Rect({', '  x: 0,', '  y: 0,', '  width: 100,', '  height: 60,', '  until: 4,', '})', '', 'c = Rect({', '  x: 300,', '  y: 0,', '  width: 100,', '  height: 60,', '  until: 4,', '})', '', 't = Text({', '  x: 0,', '  y: 200,', "  text: 'ab',", '  fontSize: 60,', '  until: 4,', '})', '', 'b.move({', '  x: (p, t) => 100,', '  relative: true,', '  at: 1,', '  duration: 1,', '})', '', 'c.move({', '  x: (p, t) => 100,', '  relative: true,', '  at: 1,', '  duration: 1,', "  ease: 'linear',", '})', '', 't.to({', "  fill: (p, i, c, t, n) => '#ff0000',", "  by: 'char',", '  stagger: 0,', '  at: 1,', '  duration: 1,', '})', ''].join('\n')
const SLOT = ['s = Text({', '  x: 0,', '  y: 0,', "  text: 'ABCD',", '  fontSize: 60,', '  until: 6,', '})', '', 's.to({', '  text: (p, i, c, t, n, settle = 2) => (t < 0.4 + (i / n) * settle ? Text.scramble(i, t) : c),', "  by: 'char',", '  stagger: 0,', '  at: 1,', '  duration: 3,', "  ease: 'linear',", '})', ''].join('\n')

const G = {
  // Kerning kept in the per-character layout (D274): each character's slot ends where the line's advance ends it, a kerned pair closer than the two alone, and the same with letter spacing.
  KERN1: `await setSource(${JSON.stringify(KERN)}); S().select([]); S().setTime(0); await tick(300); const m = S().model; const textUrl = performance.getEntriesByType('resource').map(e => e.name).find(n => n.includes('/src/model/text.ts')) ?? '/src/model/text.ts'; const text = await import(textUrl); const probe = (name) => { const style = smp.textStyleAt(m, obj(name), 0); const layout = text.layoutOf(style); const measure = text.textMeasure.current; const chars = layout.units.char; const line = layout.lines[0]; const prefix = (k) => measure(Array.from(line.text).slice(0, k).join(''), style).width; const ends = chars.map((c, k) => Math.round((c.left + c.width + style.letterSpacing - line.left) * 100) / 100); const expected = chars.map((c, k) => { const idx = Array.from(line.text).findIndex((ch, j) => j >= (k > 0 ? Array.from(line.text).indexOf(chars[k - 1].text, 0) : 0) && ch === c.text); return 0 }); const slotEnds = chars.map((c) => Math.round((c.left + c.width + style.letterSpacing - line.left) * 100) / 100); const av = measure('AV', style).width; const a = measure('A', style).width; const v = measure('V', style).width; return { slotEnds: slotEnds.slice(0, 4), prefixEnds: [1, 2, 3, 4].map(prefix).map(x => Math.round(x * 100) / 100), kerned: av < a + v - 0.5, vLeft: Math.round((chars[1].left - line.left) * 100) / 100, vLeftExpected: Math.round((av - v) * 100) / 100 } }; return { plain: probe('t'), spaced: probe('u'), err: S().error }`,
  // The frame an object begins on is its, however the time was rounded (D275): at 0.0167 for frame 1 at 60, it shows on frame 1 and is gone on the frame of its until; an action at 0.0167 has begun on frame 1.
  TOL1: `await setSource(${JSON.stringify(TOL)}); S().select([]); S().setTime(0); await tick(300); const m = S().model; const f = (n) => n / 60; const b = obj('b'); const c = obj('c'); return { atFrame1: smp.existsAt(m, b, f(1)), atFrame0: smp.existsAt(m, b, f(0)), atFrame2: smp.existsAt(m, b, f(2)), atFrame3: smp.existsAt(m, b, f(3)), gone: smp.existsAt(m, b, 0.05), moveBegun: smp.definingAction(c, 'x', f(1))?.verb ?? null, xAtFrame1: smp.valueAt(m, c, 'x', f(1)), xAtFrame2: Math.round(smp.valueAt(m, c, 'x', f(2)) * 100) / 100, err: S().error }`,
  // Frames in the code (D276): frames(30) is half a second at 60; a retime from the timeline keeps frames, whole when the time sits on a frame; the Selected pane's number too.
  FRAMES1: `await setSource(${JSON.stringify(FRAMES)}); S().select([]); S().setTime(0); await tick(300); const a = obj('b').actions[0]; const spans = { start: a.start, end: a.end, until: obj('b').until }; ops.setActionTiming('b', 0, { at: 1, duration: 0.75 }); await tick(200); const retimed = { src: S().source.match(/at: ([^,]+),\\s+duration: ([^,]+),/)?.slice(1), start: obj('b').actions[0].start, end: obj('b').actions[0].end }; ops.setActionTiming('b', 0, { duration: 0.705 }); await tick(200); const odd = S().source.match(/duration: ([^,]+),/)?.[1]; ops.setActionProp({ object: 'b', index: 0 }, 'at', 2); await tick(200); const pane = S().source.match(/at: ([^,]+),/)?.[1]; ops.setLifetime('b', { until: 5 }); await tick(200); const life = S().source.match(/until: ([^,]+),/)?.[1]; return { spans, retimed, odd, pane, life, warnings: S().model.warnings, err: S().error }`,
  // The notes beside times in the code pane (D276): a time as frames, frames as seconds; off with the preference.
  HINTS1: `await setSource(${JSON.stringify(FRAMES)}); await tick(400); const hints = () => [...document.querySelectorAll('.cm-time-hint')].map(h => h.textContent); const on = hints(); S().setPrefs({ timeHints: false }); await tick(300); const off = hints(); S().setPrefs({ timeHints: true }); await tick(300); const back = hints().length; return { on, off, back, err: S().error }`,
  // The ease as the envelope of a function of the progress (D277): ramps bring it in and out, so the thing ends as it began; linear keeps it full; on a unit the same, with the fill back to the text's own at the end.
  ENVELOPE1: `await setSource(${JSON.stringify(ENV)}); S().select([]); S().setTime(0); await tick(300); const m = S().model; const v = (n, t) => Math.round(smp.valueAt(m, obj(n), 'x', t) * 100) / 100; const text = await import('/src/model/text.ts'); const layout = text.layoutOf(smp.textStyleAt(m, obj('t'), 0)); const fill = (t) => smp.textUnitStates(m, obj('t'), t, layout)?.map(s => s.fill) ?? null; return { ramps: [v('b', 1), v('b', 1.15), v('b', 1.5), v('b', 1.85), v('b', 2), v('b', 3)], linear: [v('c', 1.15), v('c', 1.5), v('c', 1.85), v('c', 2)], fills: { at115: fill(1.15), at15: fill(1.5), at2: fill(2), at3: fill(3) }, err: S().error }`,
  // The slot machine (D278): every character spins from the start, the first lands first, the last after the settle, and all are their own by the end.
  SLOT2: `await setSource(${JSON.stringify(SLOT)}); S().select([]); S().setTime(0); await tick(300); const m = S().model; const text = await import('/src/model/text.ts'); const layout = text.layoutOf(smp.textStyleAt(m, obj('s'), 0)); const shown = (t) => smp.textUnitStates(m, obj('s'), t, layout)?.map(s => s.text ?? '.') ?? null; const own = ['A', 'B', 'C', 'D']; const spinning = (t) => shown(t)?.map((c, i) => c !== own[i]); return { at12: spinning(1.2), at16: spinning(1.6), at22: spinning(2.2), at28: spinning(2.8), at35: spinning(3.5), scrambleSteady: window.__quickAnimator ? true : false, end: obj('s').actions[0].end, err: S().error }`,
  // The families (D278): Shake under Moves, Blink under Fades, Grow and Shrink under Resizes, Color change under Miscellaneous with its rainbow; Enchanted and Slot machine write their functions.
  FAMILIES1: `await tick(200); const label = (el) => el.textContent.replace(/[\\u25B8\\u25BE]/g, '').trim(); const fam = (name) => { const s = [...document.querySelectorAll('.presets-section.sub')].find(s => label(s.querySelector('.presets-title')) === name); return s ? [...s.querySelectorAll('.preset-row .name')].map(n => n.textContent.trim()) : [] }; const pre = await import('/src/project/presets.ts'); const demo = (id, v) => pre.presetDemo(id, v).source; const rainbow = demo('colorChange', 'rainbow'); const enchanted = demo('enchanted', undefined); const slot = demo('slotMachine', undefined); return { moves: fam('Moves'), fades: fam('Fades'), resizes: fam('Resizes'), misc: fam('Miscellaneous'), rainbow: /fill: \\(progress, seconds, cycle = 5\\) => Color.hue\\(seconds \\/ cycle\\)/.test(rainbow), enchanted: /cycle = 8\\) => Color.hue\\(seconds \\/ cycle \\+ index \\/ 12\\)/.test(enchanted) && !/ease:/.test(enchanted), slot: /settle = 2\\)/.test(slot) && /stagger: 0,/.test(slot), err: S().error }`,
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
