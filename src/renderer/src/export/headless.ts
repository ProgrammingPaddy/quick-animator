import type { ExportResult, RenderJob } from '../../../shared/api'
import { openProject } from '../project/controller'
import { useStore } from '../state/store'
import { runExport } from './run'

let started = false

/**
 * A window started with the render command (R111): load the project, render the range through
 * the export path, and report progress and the result to the main process, which prints them
 * and exits. In the normal app there is no job and nothing happens.
 */
export async function runHeadless(): Promise<void> {
  const api = window.api
  if (!api || started) return
  started = true
  let job: RenderJob | null
  try {
    job = await api.render.job()
  } catch {
    return
  }
  if (!job) return
  const finish = (result: ExportResult): void => api.render.done(result)
  try {
    await openProject(job.project)
    const s = useStore.getState()
    if (s.error) return finish({ ok: false, message: `${s.error.line ? `line ${s.error.line}: ` : ''}${s.error.message}` })
    if (!s.model) return finish({ ok: false, message: 'the project has no scene' })
    const from = job.from ?? 0
    const to = job.to ?? s.contentEnd ?? 0
    if (to < from) return finish({ ok: false, message: `--to ${to} comes before --from ${from}` })
    finish(await runExport(s.model, s.settings, { from, to }, job.preset, job.out, (p) => api.render.progress(p.frame, p.total), () => false))
  } catch (err) {
    finish({ ok: false, message: err instanceof Error ? err.message : String(err) })
  }
}
