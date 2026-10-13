import { useMemo } from 'react'
import rules from '../../../../docs/animation-rules.md?raw'
import { useStore } from '../state/store'
import { renderMarkdown } from './markdown'

const SHORTCUTS: [string, string][] = [
  ['Space', 'Play; pause, which returns to where playback started'],
  ['Arrows', 'Move the selected objects a pixel when the preview was last used, else a frame in time; the selected actions a frame; with nothing selected, step the playhead'],
  ['Objects / List in the timeline', 'Objects: two lanes, Objects and Groups, like the tracks of a video editor. Each object is a clip from when it begins to when it is removed, its animations and opacity inside; clips stack by drawing order, higher up draws on top. Drag a clip\'s title up or down to change that, sideways to move it in time, its edges to trim; the arrow in its corner collapses it. List: one row per object with the opacity lane'],
  ['Ctrl + ,', 'Preferences: how long a new object lasts, and how long the final frame holds'],
  ['Home, End', 'Start, or the end of the content'],
  ['Click the selected object', 'Cycle the handles: Transform, Move, Rotate, Resize'],
  ['Ctrl + click, drag on empty space', 'Add to or remove from the selection; box-select what the drag touches, Ctrl to extend'],
  ['Ctrl + click a clip', 'Select several actions; a drag then retimes them together'],
  ['Shift + wheel', 'Lengthen or shorten the selected actions by the wheel step, in the preview or the timeline'],
  ['Wheel in the timeline', 'Scroll time; Ctrl + wheel zooms, Alt + wheel scrolls the rows'],
  ['Snap, Frames in the timeline', 'Clips and the playhead snap to whole seconds and to action starts and ends, the playhead also to every fifth frame; every time written lands on a frame'],
  ['Ctrl + X', 'Cut the selected actions or objects'],
  ['Alt + drag a handle', 'Keep the proportions: a corner along its diagonal, a side with the far side pinned'],
  ['Grid, Edges, Collide, Push in the preview', 'Grid: positions, sizes, and angles land on a grid. Edges: a dragged box aligns to other objects and the frame, with guides. Collide: dragged objects stop at the outlines of others and slide along them; Push shoves them along, springing back or, with Sticky, staying. Right-click an object to anchor it or enable passthrough on it'],
  ['Add object', 'Pick a kind, then click in the preview to place one; the tool stays on until clicked again, or Escape'],
  ['Edge / Center, Starts / Ends at playhead, Chain', 'What a resize keeps in place; whether a new animation starts or ends at the playhead; whether the animations made while Shift is held follow one another'],
  ['Ctrl + A', 'Select every object'],
  ['Shift + drag an object or a handle', 'Make the drag an animation from the playhead: a move, a rotation, or a resize'],
  ['Click a clip in the timeline', 'Select the animation and put the playhead at its start; a plain drag in the preview then sets its start state'],
  ['Shift with an animation selected', 'Jump to its end; a drag sets its end state and makes nothing new; a drag of another kind makes an animation over the same span'],
  ['Drag an object with an action selected', "Set that action's destination"],
  ['Delete', 'Delete the selected action, or the selected object'],
  ['Ctrl + C, Ctrl + V', 'Copy the selected action or object; paste an action onto the selected object, or an object as a numbered copy'],
  ['Ctrl + D', 'Duplicate the selected object with its actions'],
  ['F2', 'Rename the selected object or action'],
  ['Ctrl + Z, Ctrl + Shift + Z', 'Undo, redo, selections included'],
  ['Right-click', 'Add, rename, set classes, delete, jump to code; on empty space, add an object'],
  ['Double-click the opacity lane', 'Appear or disappear there; drag the handles of a fade'],
  ['Drag a timeline row header', 'Reorder the objects, which is also the drawing order'],
  ['Wheel', 'Zoom at the cursor, in the preview and the timeline'],
  ['Sideways wheel, middle drag', 'Pan the preview'],
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
