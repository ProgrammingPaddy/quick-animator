import { PRESETS, type ExportPreset, type ExportResult, type ProjectSettings } from '../../../shared/api'
import type { SceneModel } from '../model/types'
import { FrameRenderer } from './FrameRenderer'

export interface ExportRange {
  from: number
  to: number
}

export interface ExportProgress {
  frame: number
  total: number
}

/** The frames a range covers: from the frame at `from` up to the last one before `to`, at least one, each at its exact time (R112). */
export function frameSpan(range: ExportRange, fps: number): { first: number; count: number } {
  const first = Math.max(0, Math.round(range.from * fps))
  const end = Math.ceil(range.to * fps - 1e-6)
  return { first, count: Math.max(1, end - first) }
}

/**
 * Render a range of the scene frame by frame through the frame renderer and hand each frame to
 * the main process, which encodes it (D25). The model is the one given: edits made meanwhile do
 * not reach the file. Resolves with ffmpeg's verdict, or the failure, and never throws.
 */
export async function runExport(model: SceneModel, settings: ProjectSettings, range: ExportRange, preset: ExportPreset, path: string, onProgress: (p: ExportProgress) => void, cancelled: () => boolean): Promise<ExportResult> {
  const api = window.api?.export
  if (!api) return { ok: false, message: 'Export needs the desktop app' }
  const { first, count } = frameSpan(range, settings.fps)
  let renderer: FrameRenderer | null = null
  try {
    renderer = new FrameRenderer(settings.width, settings.height, settings.background, PRESETS[preset].alpha)
    await api.start({ preset, path, width: settings.width, height: settings.height, fps: settings.fps, frames: count })
    for (let i = 0; i < count; i++) {
      if (cancelled()) {
        await api.cancel()
        return { ok: false, message: 'Cancelled' }
      }
      await api.frame(renderer.draw(model, (first + i) / settings.fps))
      onProgress({ frame: i + 1, total: count })
    }
    return await api.finish()
  } catch (err) {
    await api.cancel().catch(() => undefined)
    // The bridge wraps a rejection from the main process in its own words.
    return { ok: false, message: (err instanceof Error ? err.message : String(err)).replace(/^Error invoking remote method '[^']+': (?:Error: )?/, '') }
  } finally {
    renderer?.dispose()
  }
}
