import { addObject } from '../project/operations'
import { ANIMATION_PRESETS, applyAnimationPreset } from '../project/presets'
import { OBJECT_KINDS, useStore } from '../state/store'

/**
 * The presets, under the objects (D217): animations that apply to the selected objects at the
 * playhead and write ordinary animations, and objects added at the middle of the frame. Object
 * state presets are coming.
 */
export function PresetsPane() {
  const selection = useStore((s) => s.selection)
  const time = useStore((s) => s.time)
  const model = useStore((s) => s.model)
  const targets = selection.filter((name) => model?.objects.some((o) => o.name === name && o.decl))
  return (
    <div className="presets">
      <div className="presets-section">
        <div className="presets-title">
          Animations <span className="dim">{targets.length > 0 ? `for ${targets.join(', ')}, at the playhead` : 'select an object first'}</span>
        </div>
        <div className="presets-grid">
          {ANIMATION_PRESETS.map((p) => (
            <button key={p.id} className="preset" disabled={targets.length === 0} title={p.title} onClick={() => applyAnimationPreset(p.id, targets, time)}>
              {p.label}
            </button>
          ))}
        </div>
      </div>
      <div className="presets-section">
        <div className="presets-title">
          Objects <span className="dim">at the playhead, in the middle of the frame</span>
        </div>
        <div className="presets-grid">
          {OBJECT_KINDS.map((k) => (
            <button key={k} className="preset" title={`Add a ${k} at the middle of the frame, beginning at the playhead`} onClick={() => addObject(k, 0, 0)}>
              {k}
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}
