export interface ProjectSettings {
  width: number
  height: number
  fps: number
  /** Seconds kept after the last action, so the final state stays for export and looping (D54). */
  hold: number
  /** The color inside the frame, behind everything, in the preview and in exports without alpha (D131). */
  background: string
}

/** A scene file with its path relative to the project folder, such as `scenes/main.js`. */
export interface ProjectFile {
  file: string
  source: string
}

export interface ProjectData {
  path: string
  name: string
  settings: ProjectSettings
  scenes: ProjectFile[]
}

export interface FileChange {
  /** The project folder. */
  path: string
  /** The changed file, relative to the project folder. */
  file: string
  source: string
}

export interface ProjectApi {
  /** Ask the user for an existing project folder. Null when cancelled. */
  pick(): Promise<string | null>
  /** Ask the user where to create a new project, create it, and return its folder. Null when cancelled. */
  create(): Promise<string | null>
  /** Read a project folder and start watching it for outside changes. */
  load(path: string): Promise<ProjectData>
  /** The last project opened, when it still exists. */
  last(): Promise<string | null>
  write(path: string, file: string, source: string): Promise<void>
  /** Ask the user for an SVG file and read it: its name without the extension, and its text. Null when cancelled (D241). */
  importSvg(): Promise<{ name: string; text: string } | null>
  /** Read a text file by its path, for a file dropped in as a path rather than a file: only an .svg (D241). */
  readFile(path: string): Promise<string>
  /** Changes made to project files from outside the app. Returns an unsubscribe function. */
  onChanged(callback: (change: FileChange) => void): () => void
}

export type ExportPreset = 'h264' | 'h265' | 'webm' | 'prores' | 'png'

/** The export formats (R110): what each is called, its file extension, none for a folder of frames, whether it keeps alpha, and whether it has a quality to set. */
export const PRESETS: Record<ExportPreset, { label: string; extension: string; alpha: boolean; quality: boolean }> = {
  h264: { label: 'H.264 mp4', extension: 'mp4', alpha: false, quality: true },
  h265: { label: 'H.265 mp4', extension: 'mp4', alpha: false, quality: true },
  webm: { label: 'VP9 webm', extension: 'webm', alpha: false, quality: true },
  prores: { label: 'ProRes 4444 mov, alpha', extension: 'mov', alpha: true, quality: false },
  png: { label: 'PNG sequence, alpha', extension: '', alpha: true, quality: false },
}

export const DEFAULT_QUALITY = 75

/**
 * The encoder's constant rate factor for a quality from 1 to 100 (D132): 75 gives each format
 * its default, 100 the best it offers at a sensible size, 1 the smallest file; null for the
 * formats with nothing to set.
 */
export function crfFor(preset: ExportPreset, quality: number): number | null {
  const q = Math.min(100, Math.max(1, Math.round(quality)))
  switch (preset) {
    case 'h264':
      return Math.round(36 - q * 0.26)
    case 'h265':
      return Math.round(40 - q * 0.27)
    case 'webm':
      return Math.round(50 - q * 0.3)
    default:
      return null
  }
}

export interface ExportOptions {
  preset: ExportPreset
  /** 1 to 100, for the formats that take one. */
  quality: number
  /** The file to write, or for a PNG sequence the folder. */
  path: string
  width: number
  height: number
  fps: number
  /** How many frames follow. */
  frames: number
}

export interface ExportResult {
  ok: boolean
  message?: string
}

/** Encoding through the main process's bundled ffmpeg (D25): one export at a time, frames as RGBA rows from the top down. */
export interface ExportApi {
  /** Ask where to save; null when cancelled. */
  pickOutput(preset: ExportPreset, suggestedName: string): Promise<string | null>
  start(options: ExportOptions): Promise<void>
  frame(pixels: Uint8Array): Promise<void>
  finish(): Promise<ExportResult>
  cancel(): Promise<void>
  reveal(path: string): Promise<void>
}

/** A headless render (R111): the project and what to write, from the command line. */
export interface RenderJob {
  project: string
  preset: ExportPreset
  quality: number
  out: string
  from: number | null
  to: number | null
}

export interface RenderApi {
  /** The job this window was started for, or null in the normal app. */
  job(): Promise<RenderJob | null>
  progress(frame: number, total: number): void
  done(result: ExportResult): void
}

/** The bridge exposed by the preload script as `window.api`. */
export interface Api {
  platform: string
  versions: { electron: string; chrome: string; node: string }
  project: ProjectApi
  export: ExportApi
  render: RenderApi
}
