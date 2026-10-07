export interface ProjectSettings {
  width: number
  height: number
  fps: number
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

/** The bridge exposed by the preload script as `window.api`. */
export interface Api {
  platform: string
  versions: { electron: string; chrome: string; node: string }
  project: ProjectApi
}
