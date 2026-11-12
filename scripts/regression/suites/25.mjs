// Links: progress on animations, link marks, linking from the right-click, unlinking, ripple.
// Steps: reload open prog PROG1 link LINK1 link LINK2 value LINK3 link MENU4 OFF
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
const me = (el, type, x, y, extra = {}) => el.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y, button: 2, buttons: 2, ...extra }));
const obj = (name) => S().model.objects.find(o => o.name === name);
const acts = (name) => obj(name).actions.map(a => [a.name, a.verb, a.start, a.end]);
const clipOf = (name) => document.querySelector('.oclip[data-object="' + name + '"]');
const setSource = async (text) => { const ed = window.__quickAnimator.getEditor(); ed.dispatch({ changes: { from: 0, to: ed.state.doc.length, insert: text } }); await tick(400) };
const items = () => (S().contextMenu?.items ?? []);
const tree = (list) => list.map(i => ({ label: i.label, keyword: i.keyword, children: i.children ? tree(i.children) : undefined }));
${body} })()`
  const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true, timeout: 120000 })
  if (r.exceptionDetails) return { EXCEPTION: r.exceptionDetails.exception?.description ?? r.exceptionDetails.text }
  return r.result.value
}
const write = async (text) => { await sleep(1500); writeFileSync(SCRATCH, text); await sleep(1500); await frame(); await sleep(200) }

const PROG = ['a = Rect({', '  x: -300,', '  y: 0,', '  width: 200,', '  height: 100,', '})', '', 'b = Rect({', '  x: 300,', '  y: 0,', '  width: 200,', '  height: 100,', '})', '', 'c = Circle({', '  x: 0,', '  y: 300,', '  radius: 50,', '})', '', 'slide = a.move({', '  x: 0,', '  at: 1,', '  duration: 2,', '})', '', 'b.move({', '  x: 0,', '  at: slide.progress(0.5),', '  duration: 1,', '})', '', 'c.move({', '  y: 0,', '  at: later.progress(0.25),', '  duration: 1,', '})', '', 'later = b.move({', '  y: 100,', '  at: 4,', '  duration: 2,', '})', ''].join('\n')

const LINK = ['a = Rect({', '  x: -300,', '  y: 0,', '  width: 200,', '  height: 100,', '  until: 5,', '})', '', 'b = Rect({', '  x: 300,', '  y: 0,', '  width: 200,', '  height: 100,', '  at: 1,', '  until: 5,', '})', '', 'a.move({', '  x: 0,', '  at: 1,', '  duration: 1,', '})', '', 'b.move({', '  x: 0,', '  at: 3,', '  duration: 1,', '})', ''].join('\n')

const VALUE = ['a = Rect({', '  x: -300,', '  y: 0,', '  width: 200,', '  height: 100,', '})', '', 'c = Circle({', '  x: () => a.x + 20,', '  y: 200,', '  radius: 50,', '})', '', 'a.move({', '  x: 100,', '  at: 1,', '  duration: 1,', '})', ''].join('\n')

const G = {
  // Progress works on animations, forward or not: b.move starts halfway through slide (at 2), c.move a quarter into later (at 4.5).
  PROG1: `await tick(300); return { err: S().error, slide: acts('a'), b: acts('b'), c: acts('c'), warnings: S().model.warnings }`,
  // Linking b.move's start to a.move's end names a.move and writes the reference; moving a.move moves b.move; unlinking writes the number back.
  LINK1: `await tick(300); ops.linkAction({ object: 'b', index: 0 }, 'at', { action: { object: 'a', index: 0 } }, 'end'); await tick(200); const linked = { src: S().source.includes('aMove = a.move({') && S().source.includes('at: aMove.end'), a: acts('a'), b: acts('b') }; const bClip = clipOf('b'); const mark = bClip.querySelector('.clip .link.time'); const target = clipOf('a').querySelector('.clip .link.target'); const marks = { text: mark?.textContent, title: mark?.title, targetTitle: target?.title }; ops.retimeActions([{ object: 'a', index: 0 }], { shift: 1 }); await tick(200); const rippled = { a: acts('a'), b: acts('b') }; ops.unlinkAction({ object: 'b', index: 0 }, 'at'); await tick(200); return { linked, marks, rippled, unlinked: { b: acts('b'), src: /at: 3,/.test(S().source) }, err: S().error }`,
  // Linking when b begins to a's removal writes at: a.end; the clip title shows it; unlinking writes the number.
  LINK2: `await tick(300); ops.linkLifetime('b', 'at', { action: { object: 'a', index: 0 } }, 'end'); await tick(200); const linked = { src: S().source.includes('at: aMove.end'), bAt: obj('b').at, title: clipOf('b').querySelector('.oclip-title .link.time')?.textContent, aTarget: clipOf('a').querySelector('.clip .link.target')?.title }; ops.linkLifetime('b', 'until', { object: 'a' }, 'end'); await tick(200); const until = { src: S().source.includes('until: a.end'), bUntil: obj('b').until, aTarget: clipOf('a').querySelector('.oclip-title .link.target')?.title }; ops.unlinkLifetime('b', 'at'); await tick(100); ops.unlinkLifetime('b', 'until'); await tick(200); return { linked, until, unlinked: { at: obj('b').at, until: obj('b').until, src: /at: 2,/.test(S().source) && /until: 5,/.test(S().source) }, err: S().error }`,
  // A value link shows on the object's clip and in the object pane.
  LINK3: `await tick(300); const t = clipOf('c').querySelector('.oclip-title .link.value'); const pane = document.querySelector('.objects .link.value'); return { clip: t?.textContent, clipTitle: t?.title, pane: pane?.title, err: S().error }`,
  // The menus: Links on the animation, which opens the links dialog on it, where Link start to listed the targets and parts (D172), and Links on the clip, where Link begin to and Link end to were.
  MENU4: `await tick(300); const bar = clipOf('b').querySelector('.clip'); const r = bar.getBoundingClientRect(); me(bar, 'contextmenu', r.left + 10, r.top + 8); await tick(100); const action = tree(items()); items().find(i => i.label === 'Links')?.run(); await tick(100); const linkTo = S().linksDialog; S().closeLinksDialog(); S().closeMenu(); const c = clipOf('b'); const cr = c.getBoundingClientRect(); me(c, 'contextmenu', cr.left + 30, cr.top + 8); await tick(100); const clip = tree(items()).map(i => i.label); S().closeMenu(); return { action: action.map(i => i.label), linkTo, clip }`,
  OFF: `S().setTool('select'); await tick(); return { tool: S().tool }`,
}
const scenes = { prog: PROG, link: LINK, value: VALUE }
for (const key of process.argv.slice(2)) {
  if (key === 'open') { console.log('open', JSON.stringify(await run(`await window.__quickAnimator.openProject('${PROJECT}'); await tick(800); return { project: S().project?.path, objects: S().model?.objects.length }`))); continue }
  if (scenes[key]) { await write(scenes[key]); continue }
  if (key === 'reload') { await run(`location.reload()`).catch(() => {}); await sleep(2500); await frame(); await sleep(300); console.log('reloaded'); continue }
  if (key === 'frame') { await frame(); await sleep(300); console.log('frame'); continue }
  console.log(key, JSON.stringify(await run(G[key])))
}
ws.close()
