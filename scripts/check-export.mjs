// Checks that export is frame exact (R112): renders a project headlessly twice to a PNG sequence,
// which must come out byte-identical (a frame is a pure function of time), and once to H.264,
// which must hold the same number of frames and match the PNGs closely. Builds the app first.
//
//   node scripts/check-export.mjs [project]      default: scripts/check-export-project
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync } from 'node:fs'
import { createRequire } from 'node:module'
import { join, resolve } from 'node:path'

const require = createRequire(import.meta.url)
const ffmpeg = require('@ffmpeg-installer/ffmpeg').path
const project = resolve(process.argv[2] ?? 'scripts/check-export-project')
const out = resolve('out/check-export')
const settings = { fps: 60, ...JSON.parse(readFileSync(join(project, 'project.json'), 'utf8')) }

const sh = (command, args, options = {}) => {
  const result = spawnSync(command, args, { encoding: 'utf8', shell: process.platform === 'win32' && command === 'npx', ...options })
  if (result.status !== 0) {
    console.error(`${command} ${args.join(' ')} failed\n${result.stdout}\n${result.stderr}`)
    process.exit(1)
  }
  return result
}
const render = (args) => sh('npx', ['electron', '.', 'render', project, ...args])

rmSync(out, { recursive: true, force: true })
mkdirSync(out, { recursive: true })
console.log('building the app')
sh('npx', ['electron-vite', 'build'])
console.log('rendering the PNG sequence twice and the H.264 file')
render(['--preset', 'png', '--out', join(out, 'a')])
render(['--preset', 'png', '--out', join(out, 'b')])
render(['--preset', 'h264', '--out', join(out, 'check.mp4')])

const digests = (dir) => readdirSync(dir).sort().map((name) => createHash('md5').update(readFileSync(join(dir, name))).digest('hex'))
const a = digests(join(out, 'a'))
const b = digests(join(out, 'b'))
const identical = a.length === b.length && a.every((hash, i) => hash === b[i])

const decoded = spawnSync(ffmpeg, ['-hide_banner', '-i', join(out, 'check.mp4'), '-map', '0:v', '-f', 'null', '-'], { encoding: 'utf8' }).stderr
const frameMatches = [...decoded.matchAll(/frame=\s*(\d+)/g)]
const mp4Frames = frameMatches.length > 0 ? Number(frameMatches.at(-1)[1]) : NaN

// The PNGs carry alpha on nothing; the video sits on the project's background, so the PNGs go onto that color first.
const background = String(settings.background ?? '#1c1c1c').replace('#', '0x')
const composite = `color=c=${background}:s=${settings.width ?? 1920}x${settings.height ?? 1080}:r=${settings.fps}[bg];[bg][1:v]overlay=shortest=1[ref];[0:v][ref]psnr`
const compared = spawnSync(ffmpeg, ['-hide_banner', '-i', join(out, 'check.mp4'), '-framerate', String(settings.fps), '-i', join(out, 'a', 'frame_%05d.png'), '-lavfi', composite, '-f', 'null', '-'], { encoding: 'utf8' }).stderr
const psnr = (key) => {
  const m = compared.match(new RegExp(`${key}:(inf|[\\d.]+)`))
  return m ? (m[1] === 'inf' ? Infinity : Number(m[1])) : NaN
}
const average = psnr('average')
const min = psnr('min')

const checks = [
  ['two PNG renders are byte-identical', identical, `${a.length} and ${b.length} frames`],
  ['the mp4 holds every frame', mp4Frames === a.length, `${mp4Frames} of ${a.length}`],
  ['the mp4 matches the PNGs (PSNR, dB)', min >= 35, `average ${average.toFixed(1)}, worst frame ${min.toFixed(1)}`],
]
let failed = false
for (const [label, ok, detail] of checks) {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${label}: ${detail}`)
  if (!ok) failed = true
}
if (!existsSync(join(out, 'check.mp4'))) failed = true
process.exit(failed ? 1 : 0)
