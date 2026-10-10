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
  /** Changes made to project files from outside the app. Returns an unsubscribe function. */
  onChanged(callback: (change: FileChange) => void): () => void
}

export type ExportPreset = 'h264' | 'h265' | 'webm' | 'prores' | 'png'

/** The export formats (R110): what each is called, its file extension, none for a folder of frames, and whether it keeps alpha. */
export const PRESETS: Record<ExportPreset, { label: string; extension: string; alpha: boolean }> = {
  h264: { label: 'H.264 mp4', extension: 'mp4', alpha: false },
  h265: { label: 'H.265 mp4', extension: 'mp4', alpha: false },
  webm: { label: 'VP9 webm', extension: 'webm', alpha: false },
  prores: { label: 'ProRes 4444 mov, alpha', extension: 'mov', alpha: true },
  png: { label: 'PNG sequence, alpha', extension: '', alpha: true },
}

export interface ExportOptions {
  preset: ExportPreset
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
