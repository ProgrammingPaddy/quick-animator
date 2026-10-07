import { schemaOf, type AttrValue } from '../model/registry'
import { definingAction, isVisibleAt, valueAt } from '../model/sample'
import { useStore } from '../state/store'
import { timecode } from '../state/time'

function formatValue(value: AttrValue): string {
  if (typeof value === 'number') return String(Math.round(value * 100) / 100)
  return String(value)
}

/**
 * Every attribute of the selection as it is at the playhead: the literal values, not the code
 * that produces them (decision D42). Display only for now (D45).
 */
export function NowPane() {
  const model = useStore((s) => s.model)
  const selection = useStore((s) => s.selection)
  const time = useStore((s) => s.time)
  const fps = useStore((s) => s.settings.fps)
  const obj = model && selection[0] ? model.objects.find((o) => o.name === selection[0]) : undefined
  const schema = obj ? schemaOf(obj.className) : undefined

  if (!model || !obj || !schema) {
    return <div className="empty">{selection.length === 0 ? 'Select something to see its values at the playhead.' : 'Nothing to show for this selection.'}</div>
  }

  const visible = isVisibleAt(obj, time)
  return (
    <div className="now">
      <div className="now-head">
        <span className="name">{obj.name}</span>
        <span className="dim">{obj.className}</span>
        <span className={`dim ${visible ? '' : 'hidden-now'}`}>
          {visible ? 'visible' : 'not visible'}, appears {timecode(obj.appears, fps)}
          {obj.disappears !== null ? `, disappears ${timecode(obj.disappears, fps)}` : ''}
        </span>
      </div>
      <table>
        <tbody>
          {schema.attrs.map((attr) => {
            const value = valueAt(model, obj, attr.name, time)
            const action = definingAction(model, obj, attr.name, time)
            const status = action
              ? action.end > time
                ? `${action.verb}, in progress`
                : `${action.verb}, done`
              : typeof obj.attrs[attr.name] === 'function'
                ? 'linked'
                : attr.name in obj.attrs
                  ? ''
                  : 'default'
            return (
              <tr key={attr.name} className={action ? 'animated' : status === 'default' ? 'default' : ''}>
                <td className="k">{attr.name}</td>
                <td className="v mono">
                  {attr.type === 'color' && typeof value === 'string' && <span className="swatch" style={{ background: value }} />}
                  {formatValue(value)}
                </td>
                <td className="s dim">{status}</td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
