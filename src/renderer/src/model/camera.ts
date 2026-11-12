import { camerasOf } from './sample'
import type { SceneModel, SceneObject } from './types'

/**
 * The stretches in which a camera has the picture (D358): its life, less the lives of the
 * cameras declared after it, which are over it. `endOf` gives where a life ends, for one with
 * no `until` too, as the timeline draws it.
 */
export function pictureSpans(model: SceneModel, camera: SceneObject, endOf: (o: SceneObject) => number): { start: number; end: number }[] {
  const all = camerasOf(model)
  let spans = [{ start: camera.at, end: endOf(camera) }]
  for (const over of all.slice(all.indexOf(camera) + 1)) {
    const cut = { start: over.at, end: endOf(over) }
    spans = spans.flatMap((s) => {
      if (cut.end <= s.start || cut.start >= s.end) return [s]
      return [...(cut.start > s.start ? [{ start: s.start, end: cut.start }] : []), ...(cut.end < s.end ? [{ start: cut.end, end: s.end }] : [])]
    })
  }
  return spans.filter((s) => s.end > s.start)
}
