// The regression chain: every suite of checks written while the app was built, run in the real
// window, each result compared with what it was when it was last looked over.
//
//   npx electron-vite dev -- --remote-debugging-port=9222
//   node scripts/regression/run.mjs                 every suite
//   node scripts/regression/run.mjs 47 m8           some of them
//   node scripts/regression/run.mjs 47 --update     keep what they return now as their baseline
//   node scripts/regression/run.mjs 47 --volatile   mark what differs now as changing from run to run
//
// A suite is a file in suites/. The numbered ones are scripts that take their steps as arguments,
// listed on their `// Steps:` line: `reload`, `open`, the name of a scene to write, or a check to
// run. The ones named m1 on are files of named bodies that `suites/m.mjs` runs. A check returns a
// value, printed as `NAME json`; baseline/ holds the value each last returned, and a run reports
// every place where a value is no longer that. A difference is either a regression, fixed in the
// app, or a change that was meant, kept with --update once it has been read.
//
// The suites work in a scratch project in the temp folder, so no project of the owner's is
// touched. The window's stored choices are set aside for the run and cleared before each suite,
// so every suite starts from the app's defaults, and put back after it, with the project that was
// open.
import { spawn } from 'node:child_process'
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = fileURLToPath(new URL('.', import.meta.url))
const args = process.argv.slice(2)
const update = args.includes('--update')
const markVolatile = args.includes('--volatile')
const wanted = args.filter((a) => !a.startsWith('--'))

/** The size the baselines were taken at: places on the screen are part of many results. */
const WINDOW = [1600, 900]

const order = (id) => (id.startsWith('m') ? 1000 + Number(id.slice(1)) : Number(id))
const all = readdirSync(join(here, 'suites'))
  .map((f) => /^(m?\d+)\.mjs$/.exec(f)?.[1])
  .filter(Boolean)
  .sort((a, b) => order(a) - order(b))
const unknown = wanted.filter((id) => !all.includes(id))
if (unknown.length > 0) throw new Error(`No such suite: ${unknown.join(', ')}`)
const suites = wanted.length > 0 ? all.filter((id) => wanted.includes(id)) : all

// The scratch folder: one project the suites open and write their scenes to, and the files some read.
const home = mkdtempSync(join(tmpdir(), 'quick-animator-regression-')).replace(/\\/g, '/')
mkdirSync(`${home}/first/scenes`, { recursive: true })
writeFileSync(`${home}/first/project.json`, JSON.stringify({ width: 1920, height: 1080, fps: 60, hold: 1, background: '#1c1c1c' }, null, 2) + '\n')
writeFileSync(`${home}/first/scenes/main.js`, 'box = Rect({\n  width: 200,\n  height: 100,\n})\n')
copyFileSync(join(here, 'assets', 'test-drawing.svg'), `${home}/test-drawing.svg`)
// A font of the project's own, for the checks of fonts loaded from a project: a system font under another name.
const georgia = 'C:/Windows/Fonts/georgia.ttf'
if (existsSync(georgia)) {
  mkdirSync(`${home}/first/assets/fonts`, { recursive: true })
  copyFileSync(georgia, `${home}/first/assets/fonts/Testfont.ttf`)
} else console.log('No Georgia among the system fonts: the checks of project fonts will differ.')

/** Evaluate in the app's page, over a connection of its own. */
async function inPage(expression) {
  const targets = await (await fetch('http://127.0.0.1:9222/json')).json()
  const page = targets.find((t) => t.type === 'page')
  if (!page) throw new Error('No app page on port 9222: start the app with --remote-debugging-port=9222')
  const ws = new WebSocket(page.webSocketDebuggerUrl)
  await new Promise((r) => ws.addEventListener('open', r))
  try {
    return await new Promise((resolve, reject) => {
      ws.addEventListener('message', (ev) => {
        const m = JSON.parse(String(ev.data))
        if (m.id !== 1) return
        if (m.error || m.result.exceptionDetails) reject(new Error(JSON.stringify(m.error ?? m.result.exceptionDetails.exception?.description)))
        else resolve(m.result.result.value)
      })
      ws.send(JSON.stringify({ id: 1, method: 'Runtime.evaluate', params: { expression: `(async () => { ${expression} })()`, awaitPromise: true, returnByValue: true } }))
    })
  } finally {
    ws.close()
  }
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
/** Wait for the app's page to be up: after a reload, or while a change to the source is still reloading it. */
const ready = async () => {
  for (let i = 0; i < 60; i++) {
    if (await inPage('return !!window.__quickAnimator?.useStore').catch(() => false)) return
    await sleep(500)
  }
  throw new Error('The app did not come up in the window on port 9222')
}
const reload = async () => {
  await inPage('location.reload()').catch(() => {})
  await sleep(1500)
  await ready()
  await sleep(1000)
}
const KEYS = `Object.keys(localStorage).filter((k) => k.startsWith('quick-animator.'))`

/** Run one suite, and return what each of its checks printed. */
function runSuite(id) {
  const file = join(here, 'suites', `${id}.mjs`)
  const steps = id.startsWith('m') ? null : /^\/\/ Steps: (.*)$/m.exec(readFileSync(file, 'utf8'))?.[1].trim().split(/\s+/)
  const argv = steps ? [file, ...steps] : [join(here, 'suites', 'm.mjs'), `${id}.mjs`]
  return new Promise((resolve) => {
    const child = spawn(process.execPath, argv, { env: { ...process.env, QA_REGRESSION_HOME: home }, stdio: ['ignore', 'pipe', 'pipe'] })
    let out = ''
    let err = ''
    child.stdout.on('data', (d) => (out += d))
    child.stderr.on('data', (d) => (err += d))
    const timer = setTimeout(() => child.kill(), 15 * 60 * 1000)
    child.on('close', (code) => {
      clearTimeout(timer)
      const results = {}
      for (const line of out.split(/\r?\n/)) {
        const m = /^([A-Z][A-Z0-9_]*) (.+)$/.exec(line)
        if (!m) continue
        try {
          results[m[1]] = JSON.parse(m[2])
        } catch {
          results[m[1]] = { UNREADABLE: m[2].slice(0, 200) }
        }
      }
      resolve({ results, failure: code === 0 ? null : (err.trim().split('\n').find((l) => /Error/.test(l)) ?? err.trim().split('\n')[0] ?? `exit ${code}`).slice(0, 300) })
    })
  })
}

/** Every place where `now` is not what `was` holds, as paths; a place under a volatile path is not looked at. */
function differences(was, now, path, volatile, out) {
  if (volatile.some((v) => path === v || path.startsWith(v + '.') || path.startsWith(v + '['))) return
  const isObject = (v) => v !== null && typeof v === 'object'
  if (isObject(was) && isObject(now) && Array.isArray(was) === Array.isArray(now)) {
    const keys = Array.isArray(was) ? Array.from({ length: Math.max(was.length, now.length) }, (_, i) => i) : [...new Set([...Object.keys(was), ...Object.keys(now)])]
    for (const k of keys) differences(was[k], now[k], Array.isArray(was) ? `${path}[${k}]` : path ? `${path}.${k}` : String(k), volatile, out)
    return
  }
  if (typeof was === 'number' && typeof now === 'number' && Math.abs(was - now) <= 1e-9) return
  if (was !== now && JSON.stringify(was) !== JSON.stringify(now)) out.push({ path, was, now })
}

/** A value for the report: short, and for two long texts, the part where they first part ways. */
function shown(value, other) {
  const text = value === undefined ? 'nothing' : JSON.stringify(value)
  if (text.length <= 140) return text
  const against = other === undefined ? '' : JSON.stringify(other)
  let i = 0
  while (i < text.length && text[i] === against[i]) i++
  const from = Math.max(0, i - 40)
  return (from > 0 ? '…' : '') + text.slice(from, from + 140) + (from + 140 < text.length ? '…' : '')
}

await ready()
const before = await inPage(`return { storage: Object.fromEntries(${KEYS}.map((k) => [k, localStorage.getItem(k)])), project: window.__quickAnimator.useStore.getState().project?.path ?? null, size: [innerWidth, innerHeight] }`)
if (before.size[0] !== WINDOW[0] || before.size[1] !== WINDOW[1]) console.log(`The window is ${before.size.join(' by ')}, the baselines were taken at ${WINDOW.join(' by ')}: places on the screen will differ.`)

let same = 0
let different = 0
const failed = []
try {
  for (const id of suites) {
    const file = join(here, 'baseline', `${id}.json`)
    const baseline = existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : { results: {}, volatile: {} }
    const started = Date.now()
    // Every suite from the app's defaults, whatever the one before it left stored or open.
    await inPage(`for (const k of ${KEYS}) localStorage.removeItem(k)`)
    await reload()
    const { results, failure } = await runSuite(id)
    const lines = []
    if (failure) lines.push(`  the suite stopped: ${failure}`)
    for (const key of new Set([...Object.keys(baseline.results), ...Object.keys(results)])) {
      const found = []
      if (!(key in results)) found.push({ path: '', was: 'a result', now: undefined })
      else if (!(key in baseline.results)) found.push({ path: '', was: undefined, now: results[key] })
      else differences(baseline.results[key], results[key], '', baseline.volatile[key] ?? [], found)
      if (found.length === 0) {
        same++
        continue
      }
      if (markVolatile && key in results && key in baseline.results) {
        baseline.volatile[key] = [...new Set([...(baseline.volatile[key] ?? []), ...found.map((d) => d.path)])]
        continue
      }
      different++
      for (const d of found) lines.push(`  ${key}${d.path ? ' ' + d.path : ''}: ${shown(d.was, d.now)} -> ${shown(d.now, d.was)}`)
    }
    if (update) {
      const volatile = Object.fromEntries(Object.entries(baseline.volatile).filter(([key]) => key in results))
      writeFileSync(file, JSON.stringify({ results, volatile }, null, 1) + '\n')
    } else if (markVolatile) writeFileSync(file, JSON.stringify(baseline, null, 1) + '\n')
    writeFileSync(`${home}/${id}.json`, JSON.stringify(results, null, 1) + '\n')
    if (lines.length > 0 && !update) failed.push(id)
    console.log(`${id.padStart(3)}  ${lines.length === 0 ? 'same' : update ? 'kept' : 'DIFFERS'}  ${Object.keys(results).length} checks, ${Math.round((Date.now() - started) / 1000)} s`)
    if (lines.length > 0) console.log(lines.join('\n'))
  }
} finally {
  // The window as it was: its stored choices and its project.
  await inPage(`for (const k of ${KEYS}) localStorage.removeItem(k); for (const [k, v] of Object.entries(${JSON.stringify(before.storage)})) localStorage.setItem(k, v)`).catch(() => {})
  if (before.project) await inPage(`await window.__quickAnimator.openProject(${JSON.stringify(before.project)})`).catch(() => {})
  await reload().catch(() => {})
}
console.log(`\n${suites.length} suites: ${same} checks the same, ${different} different${failed.length > 0 ? ` (${failed.join(' ')})` : ''}. What each returned is in ${home}`)
process.exit(failed.length > 0 ? 1 : 0)
