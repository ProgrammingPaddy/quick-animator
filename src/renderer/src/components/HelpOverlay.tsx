import { useMemo } from 'react'
import rules from '../../../../docs/animation-rules.md?raw'
import { useStore } from '../state/store'
import { renderMarkdown } from './markdown'

const SHORTCUTS: [string, string][] = [
  ['Space', 'Play or pause'],
  ['Left, Right', 'Step one frame; with Shift, ten'],
  ['Home, End', 'Start, or the end of the content'],
  ['Click the selected object', 'Cycle the drag mode: move, rotate, scale'],
  ['Shift + drag an object', 'Make the drag an animation from the playhead: a move, a rotation, or a scaling'],
  ['Drag an object with an action selected', "Set that action's destination"],
  ['Delete', 'Delete the selected action, or the selected object'],
  ['Ctrl + C, Ctrl + V', 'Copy the selected action or object; paste an action onto the selected object, or an object as a numbered copy'],
  ['Ctrl + D', 'Duplicate the selected object with its actions'],
  ['F2', 'Rename the selected object or action'],
  ['Ctrl + Z, Ctrl + Y', 'Undo, redo'],
  ['Right-click', 'Add, rename, set classes, delete, jump to code; on empty space, add an object'],
  ['Double-click the opacity lane', 'Appear or disappear there; drag the handles of a fade'],
  ['Wheel', 'Zoom at the cursor, in the preview and the timeline'],
  ['Shift + wheel, Alt + wheel', 'Pan sideways, pan up and down'],
  ['Middle drag', 'Pan the preview'],
  ['Ctrl + Space, Tab', 'Open completions, accept one or indent'],
  ['Ctrl + F', 'Search the code'],
  ['F1', 'This help'],
]

/** The rules document and the shortcuts, inside the app (D55). */
export function HelpOverlay() {
  const open = useStore((s) => s.help)
  const setHelp = useStore((s) => s.setHelp)
  const html = useMemo(() => renderMarkdown(rules), [])
  if (!open) return null
  return (
    <div
      className="dialog-backdrop"
      onPointerDown={(e) => {
        if (e.target === e.currentTarget) setHelp(false)
      }}
    >
      <div className="help" role="dialog" aria-modal="true">
        <div className="help-head">
          <span className="title">Help</span>
          <button className="icon" onClick={() => setHelp(false)} title="Close (Escape)" aria-label="Close">
            {'✕'}
          </button>
        </div>
        <div className="help-body">
          <section className="help-shortcuts">
            <h2>Shortcuts</h2>
            <table>
              <tbody>
                {SHORTCUTS.map(([keys, what]) => (
                  <tr key={keys}>
                    <td className="mono">{keys}</td>
                    <td>{what}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
          <section className="help-rules markdown" dangerouslySetInnerHTML={{ __html: html }} />
        </div>
      </div>
    </div>
  )
}
