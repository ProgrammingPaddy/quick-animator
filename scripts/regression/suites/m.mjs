// The harness of the suites m1 on: each is a file of named bodies, run in the page behind one
// prelude. The runner calls it; by hand, with the scratch folder named as the runner names it:
//   node m.mjs m8.mjs [KEY ...]     reload, open the scratch project, run the named bodies, or all
import { pathToFileURL, fileURLToPath } from 'node:url'

const SP = process.env.QA_REGRESSION_HOME
if (!SP) throw new Error('Run the suites through scripts/regression/run.mjs: it makes the scratch project they write to')
const PROJECT = `${SP}/first`

const targets = await (await fetch('http://127.0.0.1:9222/json')).json()
const page = targets.find((t) => t.type === 'page')
if (!page) throw new Error('No app page on port 9222: start the app with --remote-debugging-port=9222')
const ws = new WebSocket(page.webSocketDebuggerUrl)
let nextId = 0
const pending = new Map()
const send = (method, params = {}) =>
  new Promise((resolve, reject) => {
    const id = ++nextId
    pending.set(id, { resolve, reject })
    ws.send(JSON.stringify({ id, method, params }))
  })
await new Promise((r) => ws.addEventListener('open', r))
ws.addEventListener('message', (ev) => {
  const m = JSON.parse(String(ev.data))
  const p = pending.get(m.id)
  if (!p) return
  pending.delete(m.id)
  m.error ? p.reject(new Error(JSON.stringify(m.error))) : p.resolve(m.result)
})
// A blur or a focus reaches the app as in a window in front, wherever the test window stands.
await send('Emulation.setFocusEmulationEnabled', { enabled: true }).catch(() => {})
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
// A hidden window stops drawing; asking for a picture of it makes it draw.
const frame = () => send('Page.captureScreenshot', { format: 'jpeg', quality: 20 }).catch(() => {})

const PRELUDE = `
const ops = await import('/src/project/operations.ts');
const smp = await import('/src/model/sample.ts');
const msk = await import('/src/model/masks.ts');
const QA = window.__quickAnimator;
const st = QA.useStore; const S = () => st.getState();
const tick = (ms = 60) => new Promise(r => setTimeout(r, ms));
const pe = (el, type, x, y, extra = {}) => el.dispatchEvent(new PointerEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y, button: 0, buttons: type === 'pointerup' ? 0 : 1, pointerId: 1, isPrimary: true, pointerType: 'mouse', ...extra }));
const me = (el, type, x, y, extra = {}) => el.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y, button: 0, ...extra }));
const key = (type, k, extra = {}) => window.dispatchEvent(new KeyboardEvent(type, { key: k, code: k === 'Shift' ? 'ShiftLeft' : k, bubbles: true, cancelable: true, ...extra }));
const obj = (name) => S().model.objects.find(o => o.name === name);
const src = () => S().source;
const decl = (name) => { const o = obj(name); return o?.decl ? S().source.slice(o.decl.range.from, o.decl.range.to) : null };
const setSource = async (text) => { const ed = QA.getEditor(); ed.dispatch({ changes: { from: 0, to: ed.state.doc.length, insert: text } }); await tick(400) };
const geom = () => { const el = document.querySelector('.preview'); const r = el.getBoundingClientRect(); const zoom = Math.max(Math.min((r.width - 80) / 1920, (r.height - 80) / 1080), 0.02); const sx = (wx) => r.left + r.width / 2 + wx * zoom; const sy = (wy) => r.top + r.height / 2 - wy * zoom; return { el, r, zoom, sx, sy } };
const drag = async (g, from, to, extra = {}) => { pe(g.el, 'pointerdown', g.sx(from.x), g.sy(from.y), extra); const n = Math.max(2, Math.ceil(Math.hypot(to.x - from.x, to.y - from.y) / 20)); for (let i = 1; i <= n; i++) pe(g.el, 'pointermove', g.sx(from.x + (to.x - from.x) * i / n), g.sy(from.y + (to.y - from.y) * i / n), extra); await tick(60); pe(g.el, 'pointerup', g.sx(to.x), g.sy(to.y), extra); await tick(200) };
const click = async (g, at, extra = {}) => { pe(g.el, 'pointerdown', g.sx(at.x), g.sy(at.y), extra); await tick(30); pe(g.el, 'pointerup', g.sx(at.x), g.sy(at.y), extra); await tick(150) };
const rows = () => [...document.querySelectorAll('.object-list .object-row')].map(r => r.textContent.replace(/\\s+/g, ' ').trim());
const menu = async (el) => { const r = el.getBoundingClientRect(); el.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: r.left + 8, clientY: r.top + 8, button: 2 })); await tick(120); return [...document.querySelectorAll('.context-menu .menu-item, .context-menu button')].map(b => b.textContent.trim()) };
const pick = async (label) => { const b = [...document.querySelectorAll('.context-menu .menu-item, .context-menu button')].find(b => b.textContent.trim().startsWith(label)); if (!b) return false; b.click(); await tick(250); return true };
`

async function run(body) {
  const expression = `(async () => { ${PRELUDE}\n${body}\n})()`
  const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true, timeout: 120000 })
  if (r.exceptionDetails) return { EXCEPTION: r.exceptionDetails.exception?.description ?? r.exceptionDetails.text }
  return r.result.value
}

const [file, ...keys] = process.argv.slice(2)
try {
  const tests = (await import(pathToFileURL(fileURLToPath(new URL(file, import.meta.url))).href)).default
  await run('location.reload()').catch(() => {})
  await sleep(2800)
  await frame()
  // These suites place things by hand: no grid, and no aligning to other objects, which is the app's default.
  console.log('open', JSON.stringify(await run(`await QA.openProject('${PROJECT}'); await tick(900); S().setPreviewSnap({ on: false, edges: false }); return { project: S().project?.path, objects: S().model?.objects.length, error: S().error }`)))
  for (const key of keys.length > 0 ? keys : Object.keys(tests)) {
    await frame()
    console.log(key, JSON.stringify(await run(tests[key])))
  }
} finally {
  ws.close()
}
