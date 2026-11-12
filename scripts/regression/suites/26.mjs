// The links dialog, the object pane's search and Active filter and type folding, the Selected pane's controls, custom ease curves, no list view.
// Steps: reload open link DLG1 link DLG2 mix PANE1 mix PANE2 mix SEL4 mix SEL5 mix EASE1 OFF
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
const obj = (name) => S().model.objects.find(o => o.name === name);
const acts = (name) => obj(name).actions.map(a => ({ name: a.name, verb: a.verb, start: a.start, end: a.end, changes: a.changes, timing: { ...a.timing, ease: typeof a.timing.ease === 'function' ? 'fn' : a.timing.ease } }));
const setSource = async (text) => { const ed = window.__quickAnimator.getEditor(); ed.dispatch({ changes: { from: 0, to: ed.state.doc.length, insert: text } }); await tick(400) };
const setInput = async (el, value) => { const proto = el.type === 'checkbox' ? null : Object.getPrototypeOf(el); const setter = proto && Object.getOwnPropertyDescriptor(proto, 'value')?.set; if (setter) setter.call(el, value); else el.value = value; el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true })); await tick(60) };
const commit = async (el, value) => { el.focus(); await setInput(el, value); el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); el.blur(); await tick(200) };
const rowOf = (name) => [...document.querySelectorAll('.now-values tr')].find(tr => tr.querySelector('td.k')?.textContent === name);
${body} })()`
  const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true, timeout: 120000 })
  if (r.exceptionDetails) return { EXCEPTION: r.exceptionDetails.exception?.description ?? r.exceptionDetails.text }
  return r.result.value
}
const write = async (text) => { await sleep(1500); writeFileSync(SCRATCH, text); await sleep(1500); await frame(); await sleep(200) }

const LINK = ['a = Rect({', '  x: -300,', '  y: 0,', '  width: 200,', '  height: 100,', '  until: 5,', '})', '', 'b = Rect({', '  x: 300,', '  y: 0,', '  width: 200,', '  height: 100,', '  at: 1,', '  until: 5,', '})', '', 'a.move({', '  x: 0,', '  at: 1,', '  duration: 1,', '})', '', 'b.move({', '  x: 0,', '  at: 3,', '  duration: 1,', '})', ''].join('\n')

const MIX = ['a = Rect({', '  x: -300,', '  y: 0,', '  width: 200,', '  height: 100,', '  fill: \'#4f8cff\',', '  class: \'bars\',', '  until: 3,', '})', '', 'b = Circle({', '  x: 300,', '  y: 0,', '  radius: 60,', '  fill: \'#10b981\',', '  at: 2,', '})', '', 'c = Text({', '  text: \'Hello\',', '  y: 300,', '  opacity: 0.5,', '})', '', 'g = Group({', '  members: \'a b\',', '})', '', 'a.move({', '  x: 0,', '  at: 1,', '  duration: 1,', '})', ''].join('\n')

const G = {
  // The dialog lists animations, classes, and objects; the search narrows them; a part writes the link for the chosen end; Unlink writes the number.
  DLG1: `S().openLinksDialog({ object: 'b', index: 0 }); await tick(200); const dlg = document.querySelector('.links-dialog'); const rowsText = () => [...dlg.querySelectorAll('.links-row .links-what')].map(e => e.textContent.replace(/\\s+/g, ' ').trim()); const all = rowsText(); await setInput(dlg.querySelector('.links-search'), 'a.mo'); const narrowed = rowsText(); const row = dlg.querySelector('.links-row'); row.querySelector('.links-what').click(); await tick(100); const endBtn = [...row.querySelectorAll('.links-parts button')].find(b => b.textContent === 'end'); endBtn.click(); await tick(250); const linked = { src: S().source.includes('at: aMove.end'), b: acts('b').map(x => [x.start, x.end]), slotText: document.querySelector('.links-slot.active .v')?.textContent }; const unlink = document.querySelector('.links-slot.active button'); unlink?.click(); await tick(250); const unlinked = { src: /at: 2,/.test(S().source), slotText: document.querySelector('.links-slot.active .v')?.textContent }; document.querySelector('.links-dialog .dialog-actions button').click(); await tick(100); return { title: dlg.querySelector('.dialog-title').textContent, all, narrowed, linked, unlinked, closed: !document.querySelector('.links-dialog'), err: S().error }`,
  // For an object, the dialog links when it is removed to an animation's end.
  DLG2: `S().openLinksDialog({ object: 'b' }); await tick(200); const dlg = document.querySelector('.links-dialog'); const slots = [...dlg.querySelectorAll('.links-slot .k')].map(e => e.textContent).slice(0, 2); dlg.querySelectorAll('.links-slot input')[1].click(); await tick(60); const row = [...dlg.querySelectorAll('.links-row')].find(r => r.textContent.includes('a.move')); row.querySelector('.links-what').click(); await tick(100); [...row.querySelectorAll('.links-parts button')].find(b => b.textContent === 'end').click(); await tick(250); const res = { slots, src: S().source.includes('until: aMove.end'), bUntil: obj('b').until, err: S().error }; dlg.querySelector('.dialog-actions button').click(); await tick(100); return res`,
  // The object pane searches, dims what is not on screen, filters to Active, and folds a type section; the class group follows the search.
  PANE1: `S().setObjectsView('type'); S().setTime(0); await tick(300); const names = () => [...document.querySelectorAll('.objects li.object > .object-row .name')].map(e => e.textContent); const inactive = () => [...document.querySelectorAll('.objects li.object.inactive > .object-row .name')].map(e => e.textContent); const all = { names: names(), inactive: inactive() }; const search = document.querySelector('.objects-search'); await setInput(search, 'circ'); await tick(100); const searched = { names: names(), classGroups: document.querySelectorAll('.objects .class-group').length }; await setInput(search, ''); await tick(100); const activeBtn = (label) => [...document.querySelectorAll('.objects-filter button')].find(b => b.textContent === label); activeBtn('Show Only Active').click(); await tick(150); const active = { names: names(), nothing: !!document.querySelector('.objects .empty') }; activeBtn('Show All').click(); await tick(100); const head = [...document.querySelectorAll('.objects .group-head')].find(h => h.textContent.includes('Rect')); head.click(); await tick(100); const folded = { rectListed: names().includes('a'), collapsed: Object.keys(S().collapsed.objects) }; head.click(); await tick(100); S().setObjectsView('layers'); return { all, searched, active, folded, err: S().error }`,
  // The Active filter follows the playhead: at 2.5 s the circle is on screen and the rect is not.
  PANE2: `S().setTime(2.5); await tick(300); const dim = [...document.querySelectorAll('.objects li.object.inactive > .object-row .name')].map(e => e.textContent); S().setTime(0); await tick(100); return { dim }`,
  // The Selected pane shows an object's values with controls: typing x writes it at the playhead, the opacity slider writes, the fill well writes, the text field writes, until clears to the end.
  SEL4: `S().select(['c']); S().setTime(0); await tick(300); const x = rowOf('x').querySelector('input.number'); await commit(x, '120'); const opacity = rowOf('opacity').querySelector('input[type=range]'); opacity.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true })); await setInput(opacity, '0.8'); window.dispatchEvent(new PointerEvent('pointerup', { bubbles: true })); await tick(150); const text = rowOf('text').querySelector('textarea'); text.focus(); await setInput(text, 'Hi there'); text.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', ctrlKey: true, bubbles: true })); await tick(200); rowOf('fill').querySelector('.color-swatch').click(); await tick(100); const fill = rowOf('fill').querySelector('.color-hex'); await setInput(fill, '#ff0000'); fill.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); await tick(100); rowOf('fill').querySelector('.color-swatch').click(); await tick(150); S().select(['a']); await tick(200); const until = rowOf('until').querySelector('input.number'); await commit(until, ''); const res = { c: { x: obj('c').attrs.x, opacity: obj('c').attrs.opacity, text: obj('c').attrs.text, fill: obj('c').attrs.fill }, aUntil: obj('a').until, err: S().error }; return res`,
  // Selecting an animation shows its changes and timing with controls: the x destination, the start, the duration, the delay, and relative.
  SEL5: `S().selectAction('a', 0); await tick(300); const head = document.querySelector('.now-head')?.textContent.replace(/\\s+/g, ' ').trim(); const sections = [...document.querySelectorAll('.now-values tr.now-section td')].map(e => e.textContent); await commit(rowOf('x').querySelector('input.number'), '50'); await commit(rowOf('Start').querySelector('input.number'), '1.5'); await commit(rowOf('duration').querySelector('input.number'), '2'); await commit(rowOf('delay').querySelector('input.number'), '0.25'); const rel = rowOf('relative').querySelector('input[type=checkbox]'); rel.click(); await tick(200); return { head, sections, a: acts('a'), err: S().error }`,
  // The ease list: a named curve writes ease, custom writes a function that the sampler uses, ramps removes it; easeIn writes.
  EASE1: `S().selectAction('a', 0); await tick(300); const sel = () => rowOf('ease').querySelector('select'); await setInput(sel(), 'bounce'); await tick(200); const named = acts('a')[0].timing.ease; await setInput(sel(), 'custom'); await tick(200); const custom = { ease: acts('a')[0].timing.ease, src: /ease: \\(p\\) => p \\* p/.test(S().source) }; const x = (t) => { const smp = null; return null }; const mid = window.__quickAnimator.useStore.getState().model; const smp = await import('/src/model/sample.ts'); const half = smp.valueAt(mid, obj('a'), 'x', 1.5); await commit(rowOf('ease').querySelector('input.text'), '(p) => 1 - (1 - p) * (1 - p)'); await tick(200); const edited = /1 - \\(1 - p\\)/.test(S().source); await setInput(sel(), 'ramps'); await tick(200); const ramps = { ease: acts('a')[0].timing.ease, easeInRow: !!rowOf('easeIn') }; await commit(rowOf('easeIn').querySelector('input.number'), '0.1'); await tick(200); return { named, custom, halfWithSquare: half, expectHalf: -300 + 0.25 * 300, edited, ramps, easeIn: acts('a')[0].timing.easeIn, err: S().error }`,
  OFF: `S().select([]); S().setTool('select'); await tick(); return { listSwitch: !!document.querySelector('.view-switch'), tool: S().tool }`,
}
const scenes = { link: LINK, mix: MIX }
for (const key of process.argv.slice(2)) {
  if (key === 'open') { console.log('open', JSON.stringify(await run(`await window.__quickAnimator.openProject('${PROJECT}'); await tick(800); return { project: S().project?.path, objects: S().model?.objects.length }`))); continue }
  if (scenes[key]) { await write(scenes[key]); continue }
  if (key === 'reload') { await run(`location.reload()`).catch(() => {}); await sleep(2500); await frame(); await sleep(300); console.log('reloaded'); continue }
  if (key === 'frame') { await frame(); await sleep(300); console.log('frame'); continue }
  console.log(key, JSON.stringify(await run(G[key])))
}
ws.close()
