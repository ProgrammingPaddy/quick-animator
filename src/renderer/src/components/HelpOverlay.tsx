import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import rules from '../../../../docs/animation-rules.md?raw'
import { bindingsOf, HOTKEYS, keyLabel, NO_OVERRIDES } from '../state/hotkeys'
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
      ['File, Preferences, Help; undo and redo', 'The top bar: File drops down Open, New, Import, and Export; the arrows at the right undo and redo.'],
    ],
  },
  {
    title: 'Preview',
    entries: [
      ['Click, Ctrl + click, drag on empty space', 'Select; add to or remove from the selection; box-select what the drag touches, Ctrl to extend.'],
      ['Click the selected object', 'Cycle the handles: Transform, Move, Rotate, Resize.'],
      ['Shape tool', 'Create: click for corners, drag to draw a curve; click the first point or press Enter to close, which fills it, Escape leaves a line. Edit: click a shape, or drag a box around one; drag a point, or a box around several, Ctrl + click to add one, Delete to remove them; click the line to add a point. A clicked point shows its handles, which drag: a round point is smooth, its handles turn together, and Alt held while one drags moves it alone; a square one is a corner, each handle moves alone; an end of a line has one handle. Right-click a point for Smooth point, Corner point, or Straighten point; the line for Curve segment or Straighten segment; Shape for Smooth shape, Straighten shape, and on a line Close line or Open line, which change the outline and nothing else. Fill and stroke are the Selected pane\'s: fill none makes a shape hollow. Select moves, resizes, and turns it as a whole. Shape under a Rect or a Circle offers Convert to shape.'],
      ['Morph', 'Add on a Shape\'s lane, Shift with one of its points in the Shape tool, or Shift with its resize handles in Select: the outline animates to a target, point by point, and holds it after. The Shape tool shows the outline at the playhead, before, during, or after; a drag edits the target of the morph in force there, and in the middle of a morph writes a morph from its start to the playhead first. The Selected pane shows the target as text, curves or points. Only a Shape morphs: Convert to shape first.'],
      ['A point tied to the scene', 'In a Shape\'s points, at(x, y) names a place in the scene: that corner is drawn there whatever the shape\'s place, turn, or size, while the other points stay the shape\'s own. With a link, points: () => [[-120, -40], [120, -40], at(c.x, c.y)], the shape reaches to wherever c goes. The Shape tool moves it and writes at(x, y) back.'],
      ['Text', 'One line or several: a line break in the text starts a new line, written as \\n in the code; align sets the lines left, center, or right; weight, italic, line height, and letter spacing are in the Selected pane. The font is an installed family or a font file in the project\'s assets/fonts folder, by its file name; a font from the web is such a file put there. Double-click a Text to edit its words where they are: Enter breaks a line, Escape gives up, Ctrl + Enter or a click away keeps them. With Texts selected, the text bar at the top sets the font, size, bold, italic, and alignment of all of them; the font field narrows as you type. Shape, Convert to shape makes its letters curves, from its font\'s file, and warns of the text animations it drops.'],
      ['Import', 'The Import button, or an .svg dropped on the preview: its elements become Rects, Circles, Texts, and Shapes named after the file and their kind, grouped as the file groups them, each tagged I in the object pane with the file on hover, a small drawing scaled up to a fifth of the frame. A notice over the preview says what came in and what could not: gradients, filters, clipping, images. A window run as administrator cannot take drops from a normal Explorer; the Import button always can.'],
      ['Object, Group, Class', 'Top right of the preview: what a click picks, in Select and in the Path tool. Object picks the object; Group the outermost group it is in; Class every object of its class. The selection stays through tool changes and shows in every tool; only Select has the handles.'],
      ['Drag the body, a corner, an edge, the handle above', 'Move, resize, rotate. Alt keeps the proportions. Edge / Center says what a resize keeps in place. Grid lands positions, sizes, and angles on the grid.'],
      ['Shift + drag', 'Make the drag an animation from the playhead, a second long; Shift and the wheel set its length before it exists. Starts / Ends at playhead says which end sits at the playhead. Chain makes each animation follow the one before.'],
      ['Animation selected', 'A plain drag sets the state at the end the pin names. Shift jumps to the other end and a drag sets that state; whatever is dragged goes into the animation, which grows into a to when its verb cannot hold it.'],
      ['In the middle of an animation', 'A plain drag, a nudge, or a value typed in the Selected pane writes an animation from the animation\'s start to the playhead that meets the new state, and the playhead stays; the original runs on from the state at its own first frame, so the object snaps back to its course when the new one ends. A point of a Shape dragged in the middle of a morph writes a morph the same way.'],
      ['Wheel, middle drag', 'Zoom at the cursor; pan. Shift and the wheel pan sideways, Alt and the wheel pan up and down; over selected animations, Shift and the wheel change their length instead.'],
      ['Edges', 'A dragged box aligns to other objects and to the frame, with guides.'],
      ['Collide, Push', 'Dragged objects stop at the outlines of others and slide along them. Push shoves what a plain drag actually touches, and it stays shoved; an animation shoves what its straight line meets, and whatever that line no longer meets is let go. Right-click an object to anchor it, or to let drags pass through it.'],
      ['Select, Object, Path, Shape', 'The tools down the left; the top bar holds what the tool in hand can do. Select, the default, works on objects and on a selected path\'s points, with the transform modes. Object: pick a kind, then click to place one. Path: click an object to pick its path or start one, with Edit and Move path as its modes. Shape: Create draws one, Edit works on its points. A tool stays on until clicked again, or Escape.'],
      ['Paths', 'Among the tools on the right: shows the selected object\'s paths without one being selected. The Path tool shows every path; right-click one to hide it for now.'],
      ['Right-click', 'On an object: jump to code, rename, Shape (smooth, straighten, close or open a line, convert a Rect or a Circle), Path (edit, add, show), save as preset, classes, Collision (anchor, passthrough), duplicate, delete. On empty space: Add.'],
      ['100%, Fit', 'Actual size; fit the frame.'],
    ],
  },
  {
    title: 'Paths',
    entries: [
      ['Add path', 'The Path tool on an object without one, or right-click an object. The path begins where the object is, and a drag from there draws on. With Group picked, the path goes on the object\'s group and runs from the middle of its members; with Class picked, on its class, relative, so every member follows it from its own place.'],
      ['Edit, Move path', 'The Path tool\'s modes. Edit: a click on empty space adds a corner after the last point, a drag draws a line, kept as its corners, which makes the path a smooth curve; drag a point to move it; click the line to add one. Move path: drag any point or the line to carry the whole path; a shape that is code, a function or a link, is carried by its offset.'],
      ['The line', 'Always the way the object actually goes: a relative path shows from where the object is, a move under a path shows in the line, and a path on a member of a group shows where the group puts it. Its points sit where the object is as it reaches each.'],
      ['Dashed line', 'A path whose shape is code, a function of the progress or a link, has no points to drag and is drawn dashed; the code pane edits it, and Move path carries it. Its clip wears a small ƒ.'],
      ['Handles', 'Drag a point to move it. In Select, drag a box on empty space to pick several, Ctrl + click to add one; a drag then moves them all, and Delete removes them. Click the line between two points to add one there. A clicked point shows its handles, which drag as a shape\'s do: a round point is smooth, a square one a corner, and Alt held while a handle drags moves it alone. Right-click a point for Smooth point, Corner point, Straighten point, or Delete point; Path there holds Smooth path and Straighten path.'],
      ['Dragging the object', 'An object a path places moves its path, as a drag during a move edits the move: at the path\'s start its first point; while it runs, the playhead goes to its end and the last point moves; after it, the last point. Shift with the path selected moves the end it previews; a resize or a turn makes its own animation over the path\'s span.'],
      ['Smooth path, Straighten path, Curve segment', 'Right-click the line. Smooth path makes every point smooth, a curve through the points with handles; Straighten path makes every segment a line; Curve segment or Straighten segment does the one under the pointer. A drawn stroke smooths the path too.'],
      ['Edit path', 'Right-click the object, or click the path\'s clip: the playhead goes to its start and the handles show. The line shows whenever the object or the path is selected.'],
      ['shape, orient, offset, smooth', 'In the code, shape is the points, curves as SVG writes them, or a function of the progress for a shape from a formula; orient turns the object with the path; offset shifts the whole path; smooth curves points. See Paths under The language.'],
    ],
  },
  {
    title: 'Timeline',
    entries: [
      ['Lanes', 'Objects, Groups, and Classes. Each object is a clip from when it begins to when it is removed, its animations and opacity inside. Clips stack by drawing order: higher up draws on top.'],
      ['Drag a clip\'s title', 'Sideways moves the object in time; up or down changes the drawing order. The clip\'s edges trim when it begins and is removed. The arrow in its corner collapses it.'],
      ['Click an animation', 'Select it and put the playhead at its start. Drag it to retime it, its edges to change its length. Ctrl + click selects several; a drag then retimes them together.'],
      ['Razor', 'The blade beside Frames, or R. A click on an animation slices it there: the first piece goes to the state reached and holds it, the second continues from there, and the two run together as the whole did. The pointer, or Escape, puts it away.'],
      ['Scroll bar', 'The arrows at its ends scroll the view to the start and to the end of the content.'],
      ['Marks on a clip', 'A chain mark: the timing or a value follows something. A yellow one: something follows it. A small ƒ: the value is code of its own, a shape from a formula or a custom ease; hover for the code, which the code pane edits.'],
      ['Drag an animation up or down', 'Overlapping animations stack like clips, in the order they are written: the top one running has the say, and the ones below show through when it ends. Dragging one up or down moves it in the file.'],
      ['Opacity', 'Double-click the lane to appear or disappear there; drag a fade\'s handles.'],
      ['Shift', 'With an animation selected, previews the end the pin does not name. Shift and the wheel change the selected animations\' length.'],
      ['Wheel, Ctrl + wheel, Alt + wheel', 'Scroll time; zoom at the cursor; scroll the lanes.'],
      ['Loop', 'Plays the content again from its start, without the hold at the end.'],
      ['Snap, Frames', 'Clips and the playhead snap to whole seconds, to other animations\' starts and ends, and to where objects begin and are removed, else to every fifth frame. Frames lands every written time on a frame.'],
      ['Click the ruler', 'Moves the playhead there and deselects everything.'],
      ['Right-click', 'Add an animation, Go to start, Go to end, Begin at, End at, Edit links, Classes, Override, rename, delete, jump to code.'],
      ['Edges', 'Ctrl + Left and Ctrl + Right take the playhead to the edge before or after it, whatever is selected: where an animation starts or ends, or an object begins or is removed. The Selected pane\'s start and end times take it there too.'],
    ],
  },
  {
    title: 'Selected',
    entries: [
      ['An object', 'Every attribute with a control by type: numbers with a step, sliders for opacity and scale, a color well, checkboxes; and when it begins and is removed.'],
      ['An animation', 'What it changes, then its timing: start, duration or end, delay, ease as ramps, a named curve, or a function of your own, and relative. A value written as a range, x: [-200, 0], shows as two fields, where it begins and where it goes.'],
      ['By character, word, or line', 'On a Text\'s animation, by runs it on each character, word, or line in turn, stagger seconds apart, or the seconds a function of the index gives, each from its own place: x, y, and rotation as offsets, scale and opacity as factors, fill as its color, text as what it shows; a range, opacity: [0, 1], holds the start until the unit\'s turn, and later animations begin from what the earlier left. A value written as a function, (p, i, c) => ..., is called with the unit\'s progress, index, and own text and gives the value. The animation lasts until the last unit is done, and the text\'s own values are untouched.'],
      ['A function of the progress', 'Any value written as a function with a parameter, x: (p, t) => Math.sin(t * 40) * 12, is called with the plain progress and the seconds since the start and gives the value; the ease is its envelope: linear applies it in full, ramps bring it in and out so the thing ends as it began. A function without a parameter is a link.'],
      ['Frames', 'Any time can be frames(n), n frames at the project\'s rate; it stays frames when retimed. The code pane notes every time\'s frames beside the line, and frames\' seconds, unless turned off in Preferences.'],
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
      ['Custom', 'Right-click an animation, an object, a group, or a class and choose Save as preset: it is kept with the app, for every project, under Custom, in the same families and kinds. An animation keeps its block without its place in time; an object keeps its declaration and its animations without its place and its life; a group keeps everything it carries; a class keeps its statements, and goes onto the selected object or the one it is dropped on. Right-click one under Custom to delete it.'],
      ['Morphs', 'Circle, Square, Polygon, Star, and Blob take a Shape\'s outline to that figure, as big as the shape is; on a Rect or a Circle the object becomes a Shape first, as Convert to shape does.'],
      ['Text', 'Type on, Rise by word, Letters drop, Lines in, Fade out by word, Code typing, Enchanted, and Slot machine run on a Text\'s characters, words, or lines in turn. A title reveal: add a Text, type the title, click Rise by word.'],
      ['Miscellaneous', 'For any object: Color change in seven colors, or the rainbow turning at a rate of its own. Shake is under Moves, Blink under Fades, Grow and Shrink under Resizes.'],
      ['Categories', 'Animations stand in families by what they do: Fades, Moves, Turns, Resizes, Paths, Morphs, Text, Miscellaneous. Click a name to fold or unfold it.'],
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
      ['Folded shapes', 'Lists of points and curves are folded; the arrow in the gutter opens one, and it stays open.'],
      ['New object', 'Tab on a kind writes what defines it, its place, size, fill, and life; the rest shows as ghost lines until you write them.'],
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
  const overrides = useStore((s) => s.prefs.hotkeys) ?? NO_OVERRIDES
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
  // The keys everywhere, as the preferences bind them (D260), after the first topic's own lines.
  const keyed: Entry[] = [...HOTKEYS.filter((h) => h.scope === 'global').map((h): Entry => [bindingsOf(h, overrides).map((b) => keyLabel(b)).join(', '), h.what]), ['Preferences, Hotkeys', 'Every key above, and the preview\'s, can be changed there.']]
  const topics = TOPICS.map((t) => {
    const entries = t.title === 'Getting around' ? [...t.entries, ...keyed] : t.entries
    return { title: t.title, entries: matches(t.title) ? entries : entries.filter(([keys, what]) => matches(`${keys} ${what}`)) }
  }).filter((t) => t.entries.length > 0)
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
