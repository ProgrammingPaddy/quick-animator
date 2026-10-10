import { app, dialog, ipcMain, shell, type BrowserWindow } from 'electron'
import { spawn, type ChildProcess } from 'node:child_process'
import { existsSync, promises as fs } from 'node:fs'
import { basename, join, resolve } from 'node:path'
import { path as bundledFfmpeg } from '@ffmpeg-installer/ffmpeg'
import { PRESETS, type ExportOptions, type ExportPreset, type ExportResult, type RenderJob } from '../shared/api'

/**
 * Export (D25, R110): the renderer draws frames through its own scene renderer and sends them
 * here as raw RGBA rows; this process pipes them into the bundled ffmpeg, which encodes the
 * preset's format. One export runs at a time.
 */

/** The bundled ffmpeg: its platform package ships the binary, so nothing downloads at install time; a packaged app keeps it outside the archive. */
export function ffmpegPath(): string {
  return bundledFfmpeg.replace('app.asar', 'app.asar.unpacked')
}

/** Colors go out tagged as BT.709, the convention players assume for HD video. */
const BT709 = ['-color_primaries', 'bt709', '-color_trc', 'bt709', '-colorspace', 'bt709', '-color_range', 'tv']
/** Chroma-subsampled formats need even sizes; the conversion from RGB uses the BT.709 matrix to match the tags. */
const TO_YUV = ['-vf', 'pad=ceil(iw/2)*2:ceil(ih/2)*2:0:0:black,scale=out_color_matrix=bt709:out_range=tv']

/** The ffmpeg invocation for a preset: raw RGBA frames on stdin, the file as output. The container is named outright, so the output's extension never decides it. */
function ffmpegArgs(options: ExportOptions): string[] {
  const input = ['-hide_banner', '-loglevel', 'error', '-f', 'rawvideo', '-pix_fmt', 'rgba', '-s', `${options.width}x${options.height}`, '-r', String(options.fps), '-i', 'pipe:0']
  switch (options.preset) {
    case 'h264':
      return [...input, ...TO_YUV, '-c:v', 'libx264', '-preset', 'medium', '-crf', '17', '-pix_fmt', 'yuv420p', ...BT709, '-movflags', '+faststart', '-f', 'mp4', '-y', options.path]
    case 'h265':
      return [...input, ...TO_YUV, '-c:v', 'libx265', '-preset', 'medium', '-crf', '20', '-pix_fmt', 'yuv420p', '-tag:v', 'hvc1', ...BT709, '-movflags', '+faststart', '-f', 'mp4', '-y', options.path]
    case 'webm':
      return [...input, ...TO_YUV, '-c:v', 'libvpx-vp9', '-b:v', '0', '-crf', '28', '-row-mt', '1', '-pix_fmt', 'yuv420p', ...BT709, '-f', 'webm', '-y', options.path]
    case 'prores':
      return [...input, '-c:v', 'prores_ks', '-profile:v', '4', '-pix_fmt', 'yuva444p10le', '-vendor', 'apl0', '-f', 'mov', '-y', options.path]
    case 'png':
      return [...input, '-f', 'image2', '-start_number', '0', '-y', join(options.path, 'frame_%05d.png')]
  }
}

interface Job {
  options: ExportOptions
  process: ChildProcess
  stderr: string
  /** Set once ffmpeg has exited, with its code. */
  exit: Promise<number | null>
  failed: boolean
}

let current: Job | null = null

/** Where the output goes by default: next to the project, named after it. */
export function defaultOutput(project: string, preset: ExportPreset): string {
  const name = basename(project)
  const { extension } = PRESETS[preset]
  return join(project, extension ? `${name}.${extension}` : `${name}-frames`)
}

async function startJob(options: ExportOptions): Promise<void> {
  if (current) throw new Error('An export is already running')
  if (options.preset === 'png') await fs.mkdir(options.path, { recursive: true })
  const process = spawn(ffmpegPath(), ffmpegArgs(options), { stdio: ['pipe', 'ignore', 'pipe'], windowsHide: true })
  const job: Job = { options, process, stderr: '', failed: false, exit: new Promise((resolveExit) => process.on('close', (code) => resolveExit(code))) }
  process.stderr?.on('data', (chunk: Buffer) => {
    job.stderr = (job.stderr + chunk.toString()).slice(-4000)
  })
  process.on('error', (err) => {
    job.stderr += `\n${err.message}`
    job.failed = true
  })
  process.stdin?.on('error', () => {
    // ffmpeg closed its input early; the exit code says why.
    job.failed = true
  })
  current = job
}

/** Write one frame, waiting for ffmpeg to take it so frames never pile up in memory. */
function writeFrame(pixels: Uint8Array): Promise<void> {
  const job = current
  if (!job) return Promise.reject(new Error('No export is running'))
  if (job.failed || !job.process.stdin || job.process.stdin.destroyed) return Promise.reject(new Error(failureMessage(job)))
  return new Promise((resolveWrite, rejectWrite) => {
    const buffer = Buffer.from(pixels.buffer, pixels.byteOffset, pixels.byteLength)
    const ok = job.process.stdin!.write(buffer, (err) => {
      if (err) rejectWrite(new Error(failureMessage(job)))
    })
    if (ok) resolveWrite()
    else job.process.stdin!.once('drain', () => resolveWrite())
  })
}

function failureMessage(job: Job): string {
  const tail = job.stderr.trim().split('\n').filter(Boolean).slice(-3).join(' ')
  return tail ? `ffmpeg: ${tail}` : 'ffmpeg stopped'
}

async function finishJob(): Promise<ExportResult> {
  const job = current
  if (!job) return { ok: false, message: 'No export is running' }
  current = null
  job.process.stdin?.end()
  const code = await job.exit
  if (code === 0 && !job.failed) return { ok: true }
  return { ok: false, message: failureMessage(job) }
}

async function cancelJob(): Promise<void> {
  const job = current
  if (!job) return
  current = null
  job.process.kill()
  await job.exit
  // A video file cut short is useless; a sequence keeps the frames it has.
  if (job.options.preset !== 'png') await fs.rm(job.options.path, { force: true }).catch(() => undefined)
}

export function registerExportIpc(getWindow: () => BrowserWindow | null): void {
  ipcMain.handle('export:pickOutput', async (_event, preset: ExportPreset, suggested: string) => {
    const win = getWindow()
    const { extension, label } = PRESETS[preset]
    const options: Electron.SaveDialogOptions = {
      title: extension ? 'Export video' : 'Export frames: pick a folder name',
      buttonLabel: 'Export',
      defaultPath: join(app.getPath('videos'), extension ? `${suggested}.${extension}` : `${suggested}-frames`),
      filters: extension ? [{ name: label, extensions: [extension] }] : [],
      properties: extension ? ['showOverwriteConfirmation'] : ['createDirectory'],
    }
    const result = win ? await dialog.showSaveDialog(win, options) : await dialog.showSaveDialog(options)
    return result.canceled || !result.filePath ? null : result.filePath
  })
  ipcMain.handle('export:start', (_event, options: ExportOptions) => startJob(options))
  ipcMain.handle('export:frame', (_event, pixels: Uint8Array) => writeFrame(pixels))
  ipcMain.handle('export:finish', () => finishJob())
  ipcMain.handle('export:cancel', () => cancelJob())
  ipcMain.handle('export:reveal', (_event, path: string) => shell.showItemInFolder(path))
}

/**
 * The headless command (R111, D25): `quick-animator render <project> [--out file] [--preset p]
 * [--from s] [--to s]`. Parsed from the arguments after the executable; null when the app was
 * started normally, an error message when the command is malformed.
 */
export function parseRenderCommand(argv: string[]): RenderJob | { error: string } | null {
  const args = argv.slice(app.isPackaged ? 1 : 2)
  if (args[0] !== 'render') return null
  const usage = 'usage: quick-animator render <project> [--out file] [--preset h264|h265|webm|prores|png] [--from seconds] [--to seconds]'
  const job: RenderJob = { project: '', preset: 'h264', out: '', from: null, to: null }
  for (let i = 1; i < args.length; i++) {
    const arg = args[i]!
    const value = (): string | null => (i + 1 < args.length ? args[++i]! : null)
    if (arg === '--out' || arg === '-o') {
      const v = value()
      if (!v) return { error: `${arg} needs a file\n${usage}` }
      job.out = resolve(v)
    } else if (arg === '--preset' || arg === '-p') {
      const v = value()
      if (!v || !(v in PRESETS)) return { error: `--preset must be one of ${Object.keys(PRESETS).join(', ')}\n${usage}` }
      job.preset = v as ExportPreset
    } else if (arg === '--from' || arg === '--to') {
      const v = Number(value())
      if (!Number.isFinite(v) || v < 0) return { error: `${arg} needs seconds, 0 or more\n${usage}` }
      if (arg === '--from') job.from = v
      else job.to = v
    } else if (arg === '--help' || arg === '-h') return { error: usage }
    else if (arg.startsWith('-')) return { error: `unknown option ${arg}\n${usage}` }
    else if (!job.project) job.project = resolve(arg)
    else return { error: `unexpected argument ${arg}\n${usage}` }
  }
  if (!job.project) return { error: usage }
  if (!existsSync(join(job.project, 'project.json'))) return { error: `${job.project} is not a project folder: it has no project.json` }
  if (!job.out) job.out = defaultOutput(job.project, job.preset)
  return job
}

/** Hand the renderer its headless job and relay its progress to the terminal; the callback gets the exit code. */
export function registerRenderIpc(job: RenderJob | null, onDone: (code: number) => void): void {
  ipcMain.handle('render:job', () => job)
  if (!job) return
  let lastPercent = -1
  ipcMain.on('render:progress', (_event, frame: number, total: number) => {
    const percent = Math.floor((frame / Math.max(1, total)) * 100)
    if (percent === lastPercent) return
    lastPercent = percent
    process.stdout.write(`\r${frame}/${total} frames (${percent}%)`)
  })
  ipcMain.on('render:done', (_event, result: ExportResult) => {
    process.stdout.write('\n')
    if (result.ok) console.log(`wrote ${job.out}`)
    else console.error(`render failed: ${result.message ?? 'unknown error'}`)
    onDone(result.ok ? 0 : 1)
  })
}
