// Inspect the running Electron window over the DevTools protocol, for verifying the real app.
// Start the app with a debugging port first:  npx electron-vite dev -- --remote-debugging-port=9222
//   node scripts/inspect.mjs eval "<expression>"   evaluate in the page and print the JSON result
//   node scripts/inspect.mjs shot <file.png>       save a screenshot of the window
//   node scripts/inspect.mjs targets               list debug targets
// In development the page exposes window.__quickAnimator with useStore and openProject.
import { writeFileSync } from 'node:fs'

const port = process.env.CDP_PORT || 9222
const targets = await (await fetch(`http://127.0.0.1:${port}/json`)).json()
const [mode, arg] = process.argv.slice(2)
if (mode === 'targets') {
  console.log(JSON.stringify(targets.map((t) => ({ type: t.type, url: t.url, title: t.title })), null, 2))
  process.exit(0)
}
const page = targets.find((t) => t.type === 'page' && t.url.includes('localhost:5173')) || targets.find((t) => t.type === 'page')
if (!page) {
  console.error('no page target', targets)
  process.exit(1)
}
const ws = new WebSocket(page.webSocketDebuggerUrl)
let nextId = 0
const pending = new Map()
const send = (method, params = {}) =>
  new Promise((resolve, reject) => {
    const id = ++nextId
    pending.set(id, { resolve, reject })
    ws.send(JSON.stringify({ id, method, params }))
  })
await new Promise((resolve) => ws.addEventListener('open', resolve))
ws.addEventListener('message', (event) => {
  const msg = JSON.parse(String(event.data))
  if (msg.id && pending.has(msg.id)) {
    const p = pending.get(msg.id)
    pending.delete(msg.id)
    if (msg.error) p.reject(new Error(JSON.stringify(msg.error)))
    else p.resolve(msg.result)
  }
})
try {
  if (mode === 'shot') {
    const { data } = await send('Page.captureScreenshot', { format: 'png' })
    writeFileSync(arg, Buffer.from(data, 'base64'))
    console.log('saved', arg)
  } else {
    const result = await send('Runtime.evaluate', { expression: arg, awaitPromise: true, returnByValue: true })
    if (result.exceptionDetails) console.error('EXCEPTION', JSON.stringify(result.exceptionDetails, null, 2))
    console.log(JSON.stringify(result.result?.value ?? result.result, null, 2))
  }
} finally {
  ws.close()
}
