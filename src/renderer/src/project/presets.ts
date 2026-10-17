import { beginGesture, endGesture } from '../code/editor'
import { formatNumber } from '../model/edits'
import { attrSchema, GROUP } from '../model/registry'
import { positionAt, valueAt } from '../model/sample'
import type { SceneModel, SceneObject } from '../model/types'
import { appendActionText, appendTimed, appearHere, disappearHere, roundSeconds, setAttrsAt } from './operations'
import { useStore } from '../state/store'

/** A preset: a technique applied in one click that writes ordinary animations (D217). */
export interface Preset {
  id: string
  label: string
  title: string
}

export const ANIMATION_PRESETS: readonly Preset[] = [
  { id: 'fadeIn', label: 'Fade in', title: 'Invisible until here, then a fade in over 0.3 s.' },
  { id: 'fadeOut', label: 'Fade out', title: 'A fade out over 0.3 s from here.' },
  { id: 'popIn', label: 'Pop in', title: 'Invisible until here, then on in one frame.' },
  { id: 'popOut', label: 'Pop out', title: 'Off in one frame from here.' },
  { id: 'slideLeft', label: 'Slide in from left', title: 'Starts off the left edge of the frame and moves to where it is, over 0.6 s, easing out.' },
  { id: 'slideRight', label: 'Slide in from right', title: 'Starts off the right edge and moves to where it is, over 0.6 s, easing out.' },
  { id: 'slideTop', label: 'Slide in from top', title: 'Starts above the frame and moves to where it is, over 0.6 s, easing out.' },
  { id: 'slideBottom', label: 'Slide in from bottom', title: 'Starts below the frame and moves to where it is, over 0.6 s, easing out.' },
  { id: 'bounceIn', label: 'Bounce in', title: 'Drops from above the frame to where it is, over 0.8 s, bouncing at the end.' },
  { id: 'snapIn', label: 'Snap in', title: 'Comes in from 200 px to the left, over 0.4 s, fast then settling.' },
  { id: 'spin', label: 'Spin', title: 'A full turn counterclockwise over 1 s.' },
  { id: 'pulse', label: 'Pulse', title: 'Grows to 1.2 times its size and back, over 0.6 s.' },
  { id: 'orbit', label: 'Orbit', title: "A full circle around the frame's center over 3 s, from where it is, facing along the way; edit the center and radius in the code." },
]

/** The drawn width and height of an object at a time, before its scale, for placing it off the frame. */
function sizeOf(model: SceneModel, obj: SceneObject, time: number): { width: number; height: number } {
  const num = (attr: string): number => {
    const v = valueAt(model, obj, attr, time)
    return typeof v === 'number' ? v : 0
  }
  const scale = num('scale') || 1
  if (attrSchema(obj.className, 'radius') && !attrSchema(obj.className, 'width')) return { width: 2 * num('radius') * scale, height: 2 * num('radius') * scale }
  if (attrSchema(obj.className, 'width')) return { width: num('width') * scale, height: num('height') * scale }
  if (attrSchema(obj.className, 'fontSize')) return { width: num('fontSize') * 4 * scale, height: num('fontSize') * 1.2 * scale }
  return { width: 0, height: 0 }
}

/** Apply an animation preset to objects at a time, as one undo step; each writes ordinary animations at the playhead (D217). */
export function applyAnimationPreset(id: string, names: string[], time: number): void {
  const s = useStore.getState()
  const model = s.model
  if (!model) return
  const t = roundSeconds(time)
  beginGesture()
  try {
    for (const name of names) {
      const obj = useStore.getState().model?.objects.find((o) => o.name === name)
      if (!obj?.decl) continue
      const live = useStore.getState().model!
      const here = positionAt(live, obj, t)
      const { width, height } = sizeOf(live, obj, t)
      const frame = { width: s.settings.width, height: s.settings.height }
      const slideFrom = (x: number, y: number, extra: Record<string, number | string> = {}, duration = 0.6): void => {
        // The object waits off the frame, then moves to where it was (D217).
        setAttrsAt(name, { x: Math.round(x), y: Math.round(y) }, t)
        appendTimed(name, 'move', { x: Math.round(here.x), y: Math.round(here.y), easeIn: 0, ...extra }, 'start', t, duration)
      }
      switch (id) {
        case 'fadeIn':
          appearHere(name, t)
          break
        case 'fadeOut':
          disappearHere(name, t)
          break
        case 'popIn':
          appearHere(name, t, true)
          break
        case 'popOut':
          disappearHere(name, t, true)
          break
        case 'slideLeft':
          slideFrom(-(frame.width / 2 + width), here.y)
          break
        case 'slideRight':
          slideFrom(frame.width / 2 + width, here.y)
          break
        case 'slideTop':
          slideFrom(here.x, frame.height / 2 + height)
          break
        case 'slideBottom':
          slideFrom(here.x, -(frame.height / 2 + height))
          break
        case 'bounceIn':
          slideFrom(here.x, frame.height / 2 + height, { ease: 'bounce' }, 0.8)
          break
        case 'snapIn':
          slideFrom(here.x - 200, here.y, { ease: 'snap' }, 0.4)
          break
        case 'spin': {
          const rotation = valueAt(live, obj, 'rotation', t)
          appendTimed(name, 'rotate', { rotation: Math.round((typeof rotation === 'number' ? rotation : 0) + 360) }, 'start', t, 1)
          break
        }
        case 'pulse': {
          const scale = valueAt(live, obj, 'scale', t)
          const base = typeof scale === 'number' ? scale : 1
          appendTimed(name, 'resize', { scale: Math.round(base * 120) / 100 }, 'start', t, 0.3)
          appendTimed(name, 'resize', { scale: Math.round(base * 100) / 100 }, 'start', t + 0.3, 0.3)
          break
        }
        case 'orbit': {
          // A circle around the frame's center through where the object is; the center and radius are plain numbers in the code, for changing.
          const radius = Math.round(Math.hypot(here.x, here.y)) || 200
          const angle = Math.round((Math.atan2(here.y, here.x) * 1000) / 1000 * 1000) / 1000
          const text = `${name}.path({\n  shape: (p) => [0 + ${radius} * Math.cos(${angle} + p * 2 * Math.PI), 0 + ${radius} * Math.sin(${angle} + p * 2 * Math.PI)],\n  at: ${formatNumber(t)},\n  duration: 3,\n  ease: 'linear',\n  orient: true,\n})`
          appendActionText(name, text, t, t + 3)
          break
        }
      }
      if (obj.className === GROUP && id.startsWith('slide')) continue
    }
  } finally {
    endGesture()
  }
}
