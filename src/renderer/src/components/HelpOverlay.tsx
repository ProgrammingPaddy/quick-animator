import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import rules from '../../../../docs/animation-rules.md?raw'
import { useStore } from '../state/store'
import { renderMarkdown } from './markdown'

/** One thing the app does: what triggers it, and what happens. */
type Entry = [keys: string, what: string]

interface Topic {
  title: string
  entries: Entry[]
}

/** What the app does, by pane, each line checked against the code it describes (D195). */
const TOPICS: Topic[] = [
  {
    title: 'Getting around',
    entries: [
      ['Objects, Preview, Timeline, Code, Selected', 'The five panes. The code is the truth: everything the other panes do is a small edit to it, and undo is the code\'s undo.'],
      ['Ctrl + Z, Ctrl + Shift + Z', 'Undo, redo, the selection included.'],
      ['Space', 'Play or pause; pausing returns to where playback started.'],
      ['Home, End', 'The start, or the end of the content.'],
      ['Arrows', 'Nothing selected: step the playhead a frame, ten with Shift. Objects selected: in the preview, move them a pixel; elsewhere, Left and Right move them in time. Animations selected: Left and Right move them a frame.'],
      ['Delete, Backspace', 'Delete the selected animations, else the selected objects; with a path point picked, that point.'],
      ['Escape', 'Put a tool away; else deselect the animations; else deselect everything. Also closes menus, dialogs, and this help.'],
      ['F2', 'Rename the selected animation or object.'],
      ['Ctrl + C, Ctrl + X, Ctrl + V', 'Copy or cut the selected animation or object; paste an animation onto the selected object, or an object as a numbered copy.'],
      ['Ctrl + D', 'Duplicate the selected objects with their animations.'],
      ['Ctrl + A', 'Select every object.'],
      ['Ctrl + ,', 'Preferences: how long a new object lasts, and how long the final frame holds.'],
      ['Ctrl + E', 'Export the project as a video or an image sequence.'],
      ['F1', 'This help.'],
    ],
  },
  {
    title: 'Preview',
    entries: [
      ['Click, Ctrl + click, drag on empty space', 'Select; add to or remove from the selection; box-select what the drag touches, Ctrl to extend.'],
      ['Click the selected object', 'Cycle the handles: Transform, Move, Rotate, Resize.'],
      ['Drag the body, a corner, an edge, the handle above', 'Move, resize, rotate. Alt keeps the proportions. Edge / Center says what a resize keeps in place. Grid lands positions, sizes, and angles on the grid.'],
      ['Shift + drag', 'Make the drag an animation from the playhead, a second long; Shift and the wheel set its length before it exists. Starts / Ends at playhead says which end sits at the playhead. Chain makes each animation follow the one before.'],
      ['Animation selected', 'A plain drag sets the state at the end the pin names. Shift jumps to the other end and a drag sets that state; whatever is dragged goes into the animation, which grows into a to when its verb cannot hold it.'],
      ['Wheel, middle drag', 'Zoom at the cursor; pan. Shift and the wheel pan sideways, Alt and the wheel pan up and down; over selected animations, Shift and the wheel change their length instead.'],
      ['Edges', 'A dragged box aligns to other objects and to the frame, with guides.'],
      ['Collide, Push', 'Dragged objects stop at the outlines of others and slide along them. Push shoves what a plain drag actually touches, and it stays shoved; an animation shoves what its straight line meets, and whatever that line no longer meets is let go. Right-click an object to anchor it, or to let drags pass through it.'],
      ['Select, Object, Path', 'The tools down the left; the top bar holds what the tool in hand can do. Select, the default, works on objects and on a selected path\'s points, with the transform modes. Object: pick a kind, then click to place one. Path: click an object to pick its path or start one, with Edit and Move path as its modes. A tool stays on until clicked again, or Escape.'],
      ['Paths', 'Among the tools on the right: shows the selected object\'s paths without one being selected. The Path tool shows every path; right-click one to hide it for now.'],
      ['Right-click', 'On an object: jump to code, rename, Edit path, Add path, classes, anchor, passthrough, duplicate, delete. On empty space: Add.'],
      ['100%, Fit', 'Actual size; fit the frame.'],
    ],
  },
  {
    title: 'Paths',
    entries: [
      ['Add path', 'The Path tool on an object without one, or right-click an object. The path begins where the object is, and a drag from there draws on.'],
      ['Edit, Move path', 'The Path tool\'s modes. Edit: a click on empty space adds a corner after the last point, a drag draws a line, kept as its corners, which makes the path a smooth curve; drag a point to move it; click the line to add one. Move path: drag any point or the line to carry the whole path; a shape that is code, a function or a link, is carried by its offset.'],
      ['The line', 'Always the way the object actually goes: a relative path shows from where the object is, a move under a path shows in the line, and a path on a member of a group shows where the group puts it. Its points sit where the object is as it reaches each.'],
      ['Dashed line', 'A path whose shape is code, a function of the progress or a link, has no points to drag and is drawn dashed; the code pane edits it, and Move path carries it. Its clip wears a small ƒ.'],
      ['Handles', 'Drag a point to move it. In Select, drag a box on empty space to pick several, Ctrl + click to add one; a drag then moves them all, and Delete removes them. Click the line between two points to add one there. Right-click a point to delete it.'],
      ['Dragging the object', 'An object a path places moves its path, as a drag during a move edits the move: at the path\'s start its first point; while it runs, the playhead goes to its end and the last point moves; after it, the last point. Shift with the path selected moves the end it previews; a resize or a turn makes its own animation over the path\'s span.'],
      ['Smooth curve, Straight lines', 'Right-click the line to choose; in the code, smooth: true. A smooth path is a curve through its points, the same curve however long the path takes.'],
      ['Edit path', 'Right-click the object, or click the path\'s clip: the playhead goes to its start and the handles show. The line shows whenever the object or the path is selected.'],
      ['shape, orient, offset, smooth', 'In the code, shape is the points, or a function of the progress for a shape from a formula; orient turns the object with the path; offset shifts the whole path; smooth curves it. See Paths under The language.'],
    ],
  },
  {
    title: 'Timeline',
    entries: [
      ['Lanes', 'Objects, Groups, and Classes. Each object is a clip from when it begins to when it is removed, its animations and opacity inside. Clips stack by drawing order: higher up draws on top.'],
      ['Drag a clip\'s title', 'Sideways moves the object in time; up or down changes the drawing order. The clip\'s edges trim when it begins and is removed. The arrow in its corner collapses it.'],
      ['Click an animation', 'Select it and put the playhead at its start. Drag it to retime it, its edges to change its length. Ctrl + click selects several; a drag then retimes them together.'],
      ['Marks on a clip', 'A chain mark: the timing or a value follows something. A yellow one: something follows it. A small ƒ: the value is code of its own, a shape from a formula or a custom ease; hover for the code, which the code pane edits.'],
      ['Drag an animation up or down', 'Overlapping animations stack like clips, in the order they are written: the top one running has the say, and the ones below show through when it ends. Dragging one up or down moves it in the file.'],
      ['Opacity', 'Double-click the lane to appear or disappear there; drag a fade\'s handles.'],
      ['Shift', 'With an animation selected, previews the end the pin does not name. Shift and the wheel change the selected animations\' length.'],
      ['Wheel, Ctrl + wheel, Alt + wheel', 'Scroll time; zoom at the cursor; scroll the lanes.'],
      ['Loop', 'Plays the content again from its start, without the hold at the end.'],
      ['Snap, Frames', 'Clips and the playhead snap to whole seconds, to other animations\' starts and ends, and to where objects begin and are removed, else to every fifth frame. Frames lands every written time on a frame.'],
      ['Click the ruler', 'Moves the playhead there and deselects everything.'],
      ['Right-click', 'Add an animation, Begin at, End at, Edit links, Classes, Override, rename, delete, jump to code.'],
    ],
  },
  {
    title: 'Selected',
    entries: [
      ['An object', 'Every attribute with a control by type: numbers with a step, sliders for opacity and scale, a color well, checkboxes; and when it begins and is removed.'],
      ['An animation', 'What it changes, then its timing: start, duration or end, delay, ease as ramps, a named curve, or a function of your own, and relative. A value written as a range, x: [-200, 0], shows as two fields, where it begins and where it goes.'],
      ['Free text', 'Any field takes code. A number field given arithmetic over the scene, such as box.x + 20, or a text field naming something in the scene, becomes a link; a time field given slide.end becomes a time reference. A plain word or number stays as it is.'],
      ['Link, bake', 'A linked value shows its code and what it comes to. The link button opens Edit links; the bake icon keeps the current value and drops the link.'],
    ],
  },
  {
    title: 'Objects',
    entries: [
      ['Search, Collapse all', 'Filter by name; fold every section and group.'],
      ['Active', 'Only what exists at the playhead; with animations too, only the animations running at the playhead.'],
      ['Rows', 'Click selects, Ctrl + click extends, double-click jumps to the code. Type sections and groups fold.'],
      ['Chain marks', 'A mark says what a row\'s timing or value refers to; a yellow one, that something refers to it. Right-click for Edit links.'],
    ],
  },
  {
    title: 'Presets',
    entries: [
      ['Animations', 'Under the objects: a list of clips, each named after what it does, with its variations under the name. Click one to apply it to the selected objects at its place, the first frame of each, or the last for fade out and pop out. Drag it onto a clip in the timeline to apply it at that time, or onto an object in the preview: at the playhead when that is inside the object\'s life, a fade out ending there, else at its place.'],
      ['Search', 'The box at the top filters the lists by name, by verb, and by a preset\'s variations.'],
      ['Play mark', 'Hover or click it to watch the preset on a sample object.'],
      ['Objects', 'Each a picture of what it adds. Click to add it at the middle of the view at the playhead; drag it into the preview, where it becomes the object at the preview\'s scale and lands where dropped, or onto the timeline, where it becomes its clip and is added at that time.'],
      ['What they write', 'One named animation at the end of the file. An arrival is a move relative to the object from a distance away, written as a range, x: [-1060, 0]; a fade in is opacity: [0, 1]. The start holds until the animation begins, so the object waits off the frame or invisible. Nothing else in the file changes.'],
      ['Yours', 'Right-click an animation, an object, a group, or a class and choose Save as preset: it is kept with the app, for every project, under Yours. An animation keeps its block without its place in time; an object keeps its declaration and its animations without its place and its life; a group keeps everything it carries; a class keeps its statements, and goes onto the selected object or the one it is dropped on. Right-click one under Yours to delete it.'],
      ['Categories', 'Click a category\'s name to fold or unfold it.'],
    ],
  },
  {
    title: 'Links',
    entries: [
      ['Edit links', 'Right-click an animation or an object. The left lists what of it can follow something: its start and end, then each attribute. The right lists objects, groups, classes, and animations, searchable; each opens to its moments, start, halfway, and end, and its attributes. What fits the chosen slot links at once; the rest is dimmed and switches to the slot it fits. Every tooltip reads the same way: x follows a.x + 20, start follows slide.end.'],
      ['Unlink', 'Puts back what the link replaced, or the default when nothing had been written.'],
      ['States', 'Open an object in the links dialog: under "while", what it does, moving and its directions, turning clockwise or not, growing, shrinking, visible, hidden, fading in and out, each with its stretches to start or stop at. In the code: box.moving.end, box.moving.right[2].start, box.visible.last.end.'],
      ['In the code', 'A time reference such as slide.end, or a value link such as x: () => box.x + 20. Clips and rows wear a chain mark for each.'],
    ],
  },
  {
    title: 'Code',
    entries: [
      ['Ctrl + Space, Tab', 'Open completions; accept one, or indent. An object\'s name and a dot offer its verbs as whole blocks.'],
      ['Ctrl + F', 'Search the code.'],
      ['Ghost lines', 'Unset attributes and timing show dimmed with the values they take; click one to write it. Defaults hides them.'],
      ['Folded shapes', 'A path\'s list of points is folded; the arrow in the gutter opens it, and it stays open.'],
      ['Alt + drag a number', 'Changes it: one per 4 px, ten with Shift, a tenth with Ctrl; one undo step.'],
      ['Ease names', 'The arrow after an ease name opens the list of names.'],
      ['Lines', 'Alt + Up or Down moves a line, Shift + Alt + Up or Down copies it, Ctrl + / comments it, Ctrl + Shift + K deletes it, Ctrl + D selects the next match.'],
      ['Errors and warnings', 'Shown at their line. While the file has an error, the preview and the timeline do not edit it.'],
      ['Selection', 'The selected object or animation is tinted and scrolled into view; everything related to it gets a bar in its kind\'s color.'],
    ],
  },
]

interface Doc {
  title: string
  text: string
  html: string
}

/** The rules document, one section per heading, searchable by its words. */
function splitRules(markdown: string): Doc[] {
  const docs: Doc[] = []
  for (const part of markdown.replace(/\r\n?/g, '\n').split(/^## /m).slice(1)) {
    const newline = part.indexOf('\n')
    const title = part.slice(0, newline).trim()
    const body = part.slice(newline + 1)
    docs.push({ title, text: `${title}\n${body}`, html: renderMarkdown(`## ${title}\n${body}`) })
  }
  return docs
}

/** The text with every match of the query marked. */
function marked(text: string, query: string): ReactNode {
  if (!query) return text
  const lower = text.toLowerCase()
  const parts: ReactNode[] = []
  let from = 0
  for (;;) {
    const at = lower.indexOf(query, from)
    if (at < 0) break
    parts.push(text.slice(from, at), <mark key={at}>{text.slice(at, at + query.length)}</mark>)
    from = at + query.length
  }
  parts.push(text.slice(from))
  return parts
}

/** What the app does and the language it speaks, searchable (D55, D195). */
export function HelpOverlay() {
  const open = useStore((s) => s.help)
  const setHelp = useStore((s) => s.setHelp)
  const [query, setQuery] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)
  const docs = useMemo(() => splitRules(rules), [])
  useEffect(() => {
    if (open) {
      setQuery('')
      inputRef.current?.focus()
    }
  }, [open])
  if (!open) return null
  const q = query.trim().toLowerCase()
  const matches = (text: string): boolean => q === '' || text.toLowerCase().includes(q)
  const topics = TOPICS.map((t) => ({ title: t.title, entries: matches(t.title) ? t.entries : t.entries.filter(([keys, what]) => matches(`${keys} ${what}`)) })).filter((t) => t.entries.length > 0)
  const language = docs.filter((d) => matches(d.text))
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
          <input ref={inputRef} className="help-search" type="search" placeholder="Search the help" value={query} onChange={(e) => setQuery(e.target.value)} aria-label="Search the help" />
          <button className="icon" onClick={() => setHelp(false)} title="Close (Escape)" aria-label="Close">
            {'✕'}
          </button>
        </div>
        <div className="help-body">
          {topics.length === 0 && language.length === 0 && <div className="help-empty">Nothing matches.</div>}
          {topics.map((t) => (
            <section key={t.title} className="help-section">
              <h2>{t.title}</h2>
              <table>
                <tbody>
                  {t.entries.map(([keys, what]) => (
                    <tr key={keys}>
                      <td className="mono">{marked(keys, q)}</td>
                      <td>{marked(what, q)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>
          ))}
          {language.length > 0 && (
            <section className="help-language">
              <h1>The language</h1>
              {language.map((d) => (
                <div key={d.title} className="markdown" dangerouslySetInnerHTML={{ __html: d.html }} />
              ))}
            </section>
          )}
        </div>
      </div>
    </div>
  )
}
