import { useEffect, useMemo, useState, type MouseEvent as ReactMouseEvent, type ReactNode } from 'react'
import { beginGesture, endGesture } from '../code/editor'
import { BakeIcon } from '../components/BakeIcon'
import { ColorPicker } from '../components/ColorPicker'
import { showMenu } from '../components/ContextMenu'
import { FontField } from '../components/FontField'
import { LinkIcon } from '../components/LinkIcon'
import { actionLinks, objectLinks } from '../model/links'
import { hasPathData, parsePathData, pathAnchors } from '../model/pathData'
import { EASE_NAMES, GROUP, PIVOT_PARAMS, schemaOf, type AttrSchema, type AttrType, type AttrValue } from '../model/registry'
import { basePivot, definingAction, isVisibleAt, pathCurves, pathShape, shownValue, valueAt, withWritten, writesFrom } from '../model/sample'
import { DEFAULT_STAGGER, UNIT_KINDS } from '../model/text'
import type { Action, SceneModel, SceneObject } from '../model/types'
import { askSystemFonts } from '../project/fonts'
import { bakeActionProp, bakeObjectProp, canEdit, createGroup, easeMenuItems, frameSeconds, jumpToKey, keyActionsAt, keyBeside, keyState, prospectiveGroup, roundSeconds, setActionFrom, setActionProp, setAttrsAt, setLifetime, setObjectProp, toggleKey, type KeyState } from '../project/operations'
import { useStore } from '../state/store'
import { timecode } from '../state/time'

function formatValue(value: unknown): string {
  if (typeof value === 'number') return String(Math.round(value * 100) / 100)
  if (value === undefined || value === null) return ''
  return String(value)
}

/** Attributes with a known range get a slider beside the number (D174). */
const RANGES: Record<string, { min: number; max: number; step: number }> = {
  opacity: { min: 0, max: 1, step: 0.01 },
  scale: { min: 0, max: 3, step: 0.01 },
}

/** Attributes that hold lists of names, never code (D183). */
const NAME_LISTS = new Set(['class', 'members'])

function stepFor(attr: string): number {
  if (attr === 'scale' || attr === 'opacity') return 0.05
  return 1
}

/** The number a text field gave, or null when it is not one. */
function parse(text: string): number | null {
  const n = Number(text)
  return text.trim() !== '' && Number.isFinite(n) ? n : null
}

function sceneNames(model: SceneModel): Set<string> {
  const names = new Set<string>(model.objects.map((o) => o.name))
  for (const a of model.actions) if (a.name) names.add(a.name)
  for (const c of model.classActions) if (c.name) names.add(c.name)
  return names
}

/** Whether typed text names something in the scene, so it is code to follow rather than a word to keep (D183, D190). */
function namesScene(text: string, model: SceneModel): boolean {
  const names = sceneNames(model)
  return [...text.matchAll(/[A-Za-z_$][\w$]*/g)].some((m) => names.has(m[0]))
}

/** Whether text typed into a word or color field is code: it reaches into something in the scene, `title.text`, rather than being a word that happens to be a name (D190). */
function reachesInto(text: string, model: SceneModel): boolean {
  const m = /^\s*([A-Za-z_$][\w$]*)\s*[.([]/.exec(text)
  return !!m && sceneNames(model).has(m[1]!)
}

/** Whether text typed into a number field is code: arithmetic over the scene or over numbers; anything else is a slip, not a value (D190). */
function numberCode(text: string, model: SceneModel): boolean {
  const t = text.trim()
  if (!t) return false
  if (/^[\d\s+\-*/().%]+$/.test(t)) return true
  return namesScene(t, model) && /^[\w$\s+\-*/().%,'"\[\]]+$/.test(t)
}

/** Text as a link: a function of no arguments, unless it already is one. */
function asLink(text: string): string {
  const t = text.trim()
  return /^\(\s*\)\s*=>/.test(t) ? t : `() => ${t}`
}

/** The expression behind a link, for editing: what follows the arrow. */
function linkBody(text: string): string {
  return text.replace(/^\(\s*\)\s*=>\s*/, '').trim()
}

/** A text or number field that writes when it loses focus or Enter is pressed, and gives up on Escape; a multiline one takes Enter as a line break and writes when it loses focus or on Ctrl + Enter (D267). */
function Commit({ value, type = 'text', step, min, max, disabled, title, placeholder, list, multiline, onCommit }: { value: string; type?: 'text' | 'number'; step?: number; min?: number; max?: number; disabled?: boolean; title?: string; placeholder?: string; list?: string; multiline?: boolean; onCommit: (text: string) => void }) {
  const [draft, setDraft] = useState(value)
  useEffect(() => setDraft(value), [value])
  const commit = () => {
    if (draft !== value) onCommit(draft)
  }
  if (multiline) {
    return (
      <textarea
        className="now-input now-area"
        rows={Math.min(5, Math.max(1, draft.split('\n').length))}
        disabled={disabled}
        title={title}
        placeholder={placeholder}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
            commit()
            e.currentTarget.blur()
          } else if (e.key === 'Escape') {
            setDraft(value)
            e.currentTarget.blur()
          }
        }}
      />
    )
  }
  return (
    <input
      className={`now-input ${type}`}
      type="text"
      list={list}
      inputMode={type === 'number' ? 'decimal' : undefined}
      data-step={step}
      data-min={min}
      data-max={max}
      disabled={disabled}
      title={title}
      placeholder={placeholder}
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          commit()
          e.currentTarget.blur()
        } else if (e.key === 'Escape') {
          setDraft(value)
          e.currentTarget.blur()
        } else if (type === 'number' && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
          const n = parse(draft)
          if (n === null) return
          e.preventDefault()
          const by = (step ?? 1) * (e.shiftKey ? 10 : 1) * (e.key === 'ArrowUp' ? 1 : -1)
          let next = Math.round((n + by) * 1000) / 1000
          if (min !== undefined) next = Math.max(min, next)
          if (max !== undefined) next = Math.min(max, next)
          setDraft(String(next))
          onCommit(String(next))
        }
      }}
    />
  )
}

/** A slider whose whole drag is one undo step. */
function Slider({ value, min, max, step, disabled, onChange }: { value: number; min: number; max: number; step: number; disabled?: boolean; onChange: (value: number) => void }) {
  return (
    <input
      className="now-slider"
      type="range"
      min={min}
      max={max}
      step={step}
      disabled={disabled}
      value={Math.max(min, Math.min(max, value))}
      onPointerDown={() => {
        beginGesture()
        const up = () => {
          endGesture()
          window.removeEventListener('pointerup', up)
        }
        window.addEventListener('pointerup', up)
      }}
      onChange={(e) => onChange(Number(e.target.value))}
    />
  )
}

/** A color well, the picker every color has (D303); its picking is one undo step. */
function ColorWell({ value, disabled, onChange }: { value: string; disabled?: boolean; onChange: (value: string) => void }) {
  const hex = /^#[0-9a-f]{6}$/i.test(value) ? value : '#ffffff'
  return <ColorPicker value={hex} disabled={disabled} onChange={onChange} onOpen={beginGesture} onClose={endGesture} />
}

/** The key controls of a row (D323, D324): the key before, the diamond, the key after, and the diamond's right-click for the ease (D325). */
interface KeyControls {
  state: KeyState
  /** Why the diamond does nothing, when it does nothing: at the object's start, on a class animation's key, outside the object's life. */
  inert?: string
  previous: boolean
  next: boolean
  onToggle: () => void
  onJump: (direction: 1 | -1) => void
  onMenu?: (e: ReactMouseEvent) => void
}

/** A diamond: filled on a key, outlined when the attribute has keys elsewhere, faint when it has none. */
function KeyIcon({ state }: { state: KeyState }) {
  return (
    <svg className={`key-icon ${state}`} viewBox="0 0 12 12" width="12" height="12" aria-hidden="true">
      <path d="M6 1 L11 6 L6 11 L1 6 Z" />
    </svg>
  )
}

/** One row of the pane: a name, the control, the key controls and the link button, and a word about where the value comes from. */
function Row({ name, status, children, className, onLink, linkTitle, keys }: { name: string; status?: ReactNode; children: ReactNode; className?: string; onLink?: () => void; linkTitle?: string; keys?: KeyControls }) {
  return (
    <tr className={className}>
      <td className="k">{name}</td>
      <td className="v">{children}</td>
      <td className="l">
        {keys && (
          <span className="key-controls">
            <button className="small key-button step" disabled={!keys.previous} onClick={() => keys.onJump(-1)} title="Previous key">
              ‹
            </button>
            <button
              className={`small key-button diamond ${keys.state}`}
              disabled={!!keys.inert}
              onClick={keys.onToggle}
              onContextMenu={(e) => {
                e.preventDefault()
                e.stopPropagation()
                keys.onMenu?.(e)
              }}
              title={keys.inert ?? (keys.state === 'here' ? 'Remove the key here. Right-click: its ease' : 'Key here: an animation from the key before to this value')}
            >
              <KeyIcon state={keys.state} />
            </button>
            <button className="small key-button step" disabled={!keys.next} onClick={() => keys.onJump(1)} title="Next key">
              ›
            </button>
          </span>
        )}
        {onLink && (
          <button className="small link-button" onClick={onLink} title={linkTitle ?? 'Link it to something else'}>
            <LinkIcon />
          </button>
        )}
      </td>
      <td className="s dim">{status}</td>
    </tr>
  )
}

/** The control for a linked value: the expression, editable, what it comes to right now, and a bake button that keeps that as the value (D183, D189). */
function Linked({ expr, shown, disabled, isTime, onCommit, onBake }: { expr: string; shown: string; disabled?: boolean; isTime?: boolean; onCommit: (text: string) => void; onBake?: () => void }) {
  return (
    <span className="now-control now-linked">
      <LinkIcon />
      <Commit value={expr} disabled={disabled} title={isTime ? 'A time reference, such as slide.end' : 'Code that gives the value, such as box.x + 20'} onCommit={onCommit} />
      <span className="dim mono now-evaluated" title="What it comes to now">
        = {shown}
      </span>
      {onBake && (
        <button className="small bake-button" onClick={onBake} disabled={disabled} title="Bake the evaluated expression">
          <BakeIcon />
        </button>
      )}
    </span>
  )
}

/** The control for a plain value by its type; typed code becomes a link (D174, D183). */
function Field({ type, name, value, model, disabled, doc, range, step, options, families, multiline, onValue, onCode }: { type: AttrType; name: string; value: AttrValue; model: SceneModel; disabled: boolean; doc?: string; range?: { min: number; max: number; step: number }; step?: number; options?: readonly string[]; families?: readonly string[]; multiline?: boolean; onValue: (value: AttrValue) => void; onCode: (text: string) => void }) {
  if (type === 'number') {
    const n = typeof value === 'number' ? value : 0
    return (
      <span className="now-control">
        {range && <Slider value={n} min={range.min} max={range.max} step={range.step} disabled={disabled} onChange={(v) => onValue(v)} />}
        <Commit
          value={formatValue(value)}
          type="number"
          step={step}
          min={range?.min}
          disabled={disabled}
          title={doc ? `${doc} A number, or code such as box.x + 20.` : 'A number, or code such as box.x + 20'}
          onCommit={(text) => {
            const num = parse(text)
            if (num !== null) onValue(num)
            else if (numberCode(text, model)) onCode(asLink(text))
          }}
        />
      </span>
    )
  }
  if (type === 'color') {
    const text = typeof value === 'string' ? value : '#ffffff'
    return (
      <span className="now-control">
        <ColorWell value={text} disabled={disabled} onChange={(v) => onValue(v)} />
        <Commit value={text} disabled={disabled} title={doc} onCommit={(t) => (reachesInto(t, model) ? onCode(asLink(t)) : onValue(t.trim()))} />
      </span>
    )
  }
  if (type === 'boolean') return <input type="checkbox" checked={value === true} disabled={disabled} onChange={(e) => onValue(e.target.checked)} />
  // A font family narrows as you type (D271).
  if (families) return <FontField value={String(value)} options={families} disabled={disabled} title={doc} onCommit={(f) => onValue(f)} />
  // A word from a fixed few is a list (D267).
  if (options) {
    return (
      <select className="now-select" value={String(value)} disabled={disabled} title={doc} onChange={(e) => onValue(e.target.value)}>
        {options.map((o) => (
          <option key={o} value={o}>
            {o}
          </option>
        ))}
      </select>
    )
  }
  return (
    <Commit
      value={String(value)}
      disabled={disabled}
      multiline={multiline}
      title={NAME_LISTS.has(name) ? `${doc ?? ''} Names separated by spaces.` : multiline ? `${doc ?? ''} Enter starts a new line; click away to keep it.` : `${doc ?? ''} Words, or code such as title.text.`}
      onCommit={(t) => {
        if (NAME_LISTS.has(name)) onValue(t.trim())
        else if (reachesInto(t, model)) onCode(asLink(t))
        else onValue(t)
      }}
    />
  )
}

/**
 * Everything about the selection, with controls that write to the code (D42, D174, D183): an
 * object's attributes as they are at the playhead, or a selected animation's changes and timing.
 * Numbers get a field and, where the range is known, a slider; colors a well; words a field; yes
 * or no a box; the easing a list of curves, the ramps, or a curve of your own. Any field takes
 * code that names something in the scene, which becomes a link; a linked value shows its code
 * and what it comes to, and every row has a button to the links dialog.
 */
export function NowPane() {
  const model = useStore((s) => s.model)
  const selection = useStore((s) => s.selection)
  const selectedActions = useStore((s) => s.selectedActions)
  // The playhead matters only while something is shown, so the pane follows it only then.
  const time = useStore((s) => (s.selection.length > 0 || s.selectedActions.length > 0 ? s.time : 0))
  const fps = useStore((s) => s.settings.fps)
  const openLinksDialog = useStore((s) => s.openLinksDialog)
  const editable = canEdit()
  const ref = selectedActions[0]
  const actionObj = model && ref ? model.objects.find((o) => o.name === ref.object) : undefined
  const action = actionObj && ref ? actionObj.actions[ref.index] : undefined
  if (model && actionObj && action && ref) return <ActionView model={model} obj={actionObj} action={action} index={ref.index} fps={fps} editable={editable} openLinks={(key) => openLinksDialog({ object: actionObj.name, index: ref.index, key })} />

  // Two or more selected things are a group not yet made (D326): the pane shows the group's values, and a change or a key makes it.
  const prospective = selection.length > 1 && selectedActions.length === 0 && model ? prospectiveGroup() : null
  if (model && prospective) {
    const group: SceneObject = { id: -1, name: prospective.name, className: GROUP, attrs: { members: prospective.members.join(' ') }, codeDriven: false, decl: null, actions: [], classes: [], groups: [], at: 0, until: null }
    const attrs = schemaOf(GROUP)!.attrs.filter((a) => !a.hidden && a.animatable)
    return <ObjectView model={model} obj={group} attrs={attrs} time={time} editable={editable} openLinks={() => {}} make={() => createGroup(prospective.members)} />
  }
  const obj = model && selection[0] ? model.objects.find((o) => o.name === selection[0]) : undefined
  const schema = obj ? schemaOf(obj.className) : undefined
  if (!model || !obj || !schema) {
    return <div className="empty">{selection.length === 0 ? 'Nothing selected.' : 'Nothing to show.'}</div>
  }
  return <ObjectView model={model} obj={obj} attrs={schema.attrs.filter((a) => !a.hidden)} time={time} editable={editable} openLinks={(key) => openLinksDialog({ object: obj.name, key })} />
}

/**
 * An object's values at the playhead. With `make`, the object is a group not yet made (D326):
 * the rows show a group's defaults, and the first change or key makes the group, through
 * `make`, and goes to it.
 */
function ObjectView({ model, obj, attrs, time, editable, openLinks, make }: { model: SceneModel; obj: SceneObject; attrs: AttrSchema[]; time: number; editable: boolean; openLinks: (key: string) => void; make?: () => string | null }) {
  const visible = make ? true : isVisibleAt(model, obj, time)
  const links = objectLinks(obj)
  const locked = !editable || obj.codeDriven || (!obj.decl && !make)
  const fps = useStore((s) => s.settings.fps)
  /** The object a change goes to: the group once made, else the object itself; null when a group could not be made. */
  const target = (): string | null => (make ? make() : obj.name)
  // The font field offers the project's fonts and the installed families (D267).
  const isText = obj.className === 'Text'
  const fonts = useStore((s) => s.fonts)
  const systemFonts = useStore((s) => s.systemFonts)
  useEffect(() => {
    if (isText) askSystemFonts()
  }, [isText])
  const families = useMemo(() => (isText ? [...new Set([...fonts, ...systemFonts])] : []), [isText, fonts, systemFonts])
  return (
    <div className="now-values">
      <div className="now-head">
        <span className="name">{obj.name}</span>
        <span className="dim">{obj.className}</span>
        <span className={`dim ${visible ? '' : 'hidden-now'}`} title={make ? 'Not made yet: a value or a key makes it' : undefined}>
          {make ? String(obj.attrs['members'] ?? '').split(/\s+/).filter(Boolean).join(' · ') : visible ? 'visible' : time < obj.at ? `does not exist until ${obj.at} s` : obj.until !== null && time >= obj.until ? `does not exist after ${obj.until} s` : 'not visible: opacity is 0'}
        </span>
        {obj.codeDriven && <span className="badge">code</span>}
      </div>
      <table>
        <tbody>
          {sectioned(attrs, obj.className).flatMap(({ label, attrs: group }) => [
            <tr className="now-section" key={`section:${label}`}>
              <td colSpan={4}>{label}</td>
            </tr>,
            ...group.map((attr) => {
            const link = links.find((l) => l.key === attr.name)
            const isLife = attr.name === 'at' || attr.name === 'until'
            // A group's unset pivot is the center of its members' box at time zero (D124); an object's lifetime shows as resolved (D138).
            const value: AttrValue = obj.className === GROUP && (attr.name === 'pivotX' || attr.name === 'pivotY') && !(attr.name in obj.attrs) ? basePivot(model, obj)[attr.name === 'pivotX' ? 'x' : 'y'] : attr.name === 'at' ? obj.at : attr.name === 'until' ? (obj.until ?? 'end') : valueAt(model, obj, attr.name, time)
            const defining = definingAction(obj, attr.name, time)
            const status = link
              ? 'linked'
              : attr.type === 'points'
                ? `${Array.isArray(value) ? value.length : 0} points`
                : attr.type === 'pathdata'
                  ? hasPathData(value)
                    ? `${pathAnchors(parsePathData(value)).length} anchors`
                    : ''
                  : defining
                ? `${defining.name ? `${defining.name} ` : ''}${defining.verb}${defining.timing.relative ? ' (relative)' : ''}${defining.start > time ? ', holds its start' : defining.end > time ? ', in progress' : ', done'}`
                : attr.name in obj.attrs
                  ? ''
                  : 'default'
            const writeValue = (next: AttrValue | null) => {
              const name = target()
              if (name === null) return
              if (isLife) {
                if (attr.name === 'at') setLifetime(name, { at: typeof next === 'number' ? next : null })
                else setLifetime(name, { until: typeof next === 'number' ? next : null })
              } else if (typeof next === 'number' && attr.animatable && attr.type === 'number') {
                // The row shows the attribute's own value, where the solver works in what shows through the object's groups (D124): the typed value is passed as what it would show, so what is written is what was typed.
                const fresh = useStore.getState().model
                const real = fresh?.objects.find((o) => o.name === name)
                const definer = real ? definingAction(real, attr.name, time) : null
                const shown = fresh && real ? shownValue(...withWritten(fresh, real, definer, attr.name, next, definer && writesFrom(definer, attr.name, time) ? 'from' : 'to'), attr.name, time) : next
                setAttrsAt(name, { [attr.name]: typeof shown === 'number' ? shown : next }, time)
              }
              else if (defining?.stmt && !defining.classAction && next !== null) setActionProp({ object: name, index: obj.actions.indexOf(defining) }, attr.name, next)
              else setObjectProp(name, attr.name, next === '' && NAME_LISTS.has(attr.name) ? null : next)
            }
            const writeCode = (text: string) => {
              const name = target()
              if (name !== null) setObjectProp(name, attr.name, text, true)
            }
            // The key controls (D323): on every value an animation can arrive at; a Shape's outline on the row that holds it, keyed as a morph.
            const outline = attr.type === 'points' ? !hasPathData(valueAt(model, obj, 'curves', time)) : attr.type === 'pathdata' ? hasPathData(value) : false
            let keys: KeyControls | undefined
            if (!isLife && !link && !NAME_LISTS.has(attr.name) && !locked && (attr.animatable || outline)) {
              const slack = frameSeconds(fps) / 2
              const keyNow = keyState(obj, attr.name, time)
              const inert = Math.abs(time - obj.at) <= slack
                  ? 'The start: the declaration is this key'
                  : time < obj.at || (obj.until !== null && time > obj.until)
                    ? 'Outside its life'
                    : keyNow === 'here' && keyActionsAt(obj, attr.name, time).length === 0
                      ? "A class animation's key: it is edited for every member"
                      : undefined
              const arriving = keyActionsAt(obj, attr.name, time)
              keys = {
                state: keyNow,
                inert,
                previous: !make && keyBeside(obj, attr.name, time, -1) !== null,
                next: !make && keyBeside(obj, attr.name, time, 1) !== null,
                onToggle: () => {
                  const name = target()
                  if (name !== null) toggleKey(name, attr.name, time)
                },
                onJump: (direction) => jumpToKey(obj.name, attr.name, direction),
                onMenu: arriving.length > 0 ? (e) => showMenu(e, easeMenuItems({ object: obj.name, index: arriving[arriving.length - 1]! })) : undefined,
              }
            }
            let control: ReactNode
            if (link) {
              const shown = isLife ? (attr.name === 'at' ? formatValue(obj.at) : obj.until === null ? 'end' : formatValue(obj.until)) : formatValue(valueAt(model, obj, attr.name, time))
              control = <Linked expr={isLife ? link.text : linkBody(link.text)} shown={shown} disabled={locked} isTime={isLife} onCommit={(t) => (t.trim() ? writeCode(isLife ? t.trim() : asLink(t)) : writeValue(null))} onBake={() => bakeObjectProp(obj.name, attr.name, time)} />
            } else if (isLife) {
              control = (
                <span className="now-control">
                  <Commit
                    value={attr.name === 'until' && obj.until === null ? '' : formatValue(value)}
                    type="number"
                    step={0.1}
                    min={0}
                    disabled={locked}
                    placeholder={attr.name === 'until' ? 'end' : '0'}
                    title={attr.name === 'until' ? 'Seconds, a time reference such as slide.end, or empty to last to the end' : 'Seconds, or a time reference such as slide.end'}
                    onCommit={(text) => {
                      const num = parse(text)
                      if (num !== null) writeValue(num)
                      else if (text.trim()) writeCode(text.trim())
                      else writeValue(null)
                    }}
                  />
                </span>
              )
            } else if (attr.type === 'points') {
              // A Shape's points are written as code: a list, [[x, y], ...], or a word such as Shape.star(5, 100, 50) (D232).
              const raw = obj.decl?.props.find((p) => p.key === attr.name)?.raw ?? ''
              control = <Commit value={raw.replace(/\s+/g, ' ').trim()} disabled={locked} title="[[x, y], ...], or Shape.rect, circle, polygon, star" onCommit={(t) => t.trim() && writeCode(t.trim())} />
            } else if (attr.type === 'pathdata') {
              // A Shape's path is SVG path data, written as is; anything else, a word or a link, is written as code (D238).
              const raw = obj.decl?.props.find((p) => p.key === attr.name)?.raw ?? ''
              control = (
                <Commit
                  value={(hasPathData(value) ? value : raw).replace(/\s+/g, ' ').trim()}
                  disabled={locked}
                  title="SVG path data, 'M 0 0 L 100 0 ... Z'"
                  onCommit={(t) => {
                    const text = t.trim()
                    if (!text) writeValue(null)
                    else if (/^[MmLlHhVvCcSsQqTtAaZz][\s\d.,-]/.test(text)) writeValue(text)
                    else writeCode(text)
                  }}
                />
              )
            } else {
              control = <Field type={attr.type} name={attr.name} value={value} model={model} disabled={locked} doc={attr.doc} range={RANGES[attr.name]} step={stepFor(attr.name)} options={attr.options} families={isText && attr.name === 'font' ? families : undefined} multiline={isText && attr.name === 'text'} onValue={writeValue} onCode={writeCode} />
            }
            return (
              <Row key={attr.name} name={attr.name} status={status} className={defining ? 'animated' : status === 'default' ? 'default' : ''} onLink={locked || make || NAME_LISTS.has(attr.name) ? undefined : () => openLinks(attr.name)} linkTitle={`Link ${attr.name} to something else`} keys={keys}>
                {control}
              </Row>
            )
          }),
          ])}
        </tbody>
      </table>
    </div>
  )
}

/** The pane's sections for an object's values (D330): when it exists, where it is, how big, its colors, its lists, then what its class adds. */
const SECTIONS: [string, string[]][] = [
  ['Life', ['at', 'until']],
  ['Position', ['x', 'y', 'z', 'rotation', 'pivotX', 'pivotY']],
  ['Size', ['width', 'height', 'radius', 'scale', 'fontSize']],
  ['Color', ['fill', 'stroke', 'strokeWidth', 'fillOpacity', 'strokeOpacity', 'opacity']],
  ['Classes', ['class', 'members']],
]

function sectioned(attrs: AttrSchema[], className: string): { label: string; attrs: AttrSchema[] }[] {
  const placed = new Set<string>()
  const out: { label: string; attrs: AttrSchema[] }[] = []
  for (const [label, names] of SECTIONS) {
    const group = names.map((n) => attrs.find((a) => a.name === n)).filter((a): a is AttrSchema => !!a)
    for (const a of group) placed.add(a.name)
    if (group.length > 0) out.push({ label, attrs: group })
  }
  const rest = attrs.filter((a) => !placed.has(a.name))
  if (rest.length > 0) out.push({ label: className, attrs: rest })
  return out
}

const RAMPS = 'ramps'
const CUSTOM = 'custom'

function ActionView({ model, obj, action, index, fps, editable, openLinks }: { model: SceneModel; obj: SceneObject; action: Action; index: number; fps: number; editable: boolean; openLinks: (key: string) => void }) {
  const schema = schemaOf(obj.className)
  const derived = !!action.classAction
  const locked = !editable || derived || !action.stmt || action.codeDriven
  const ref = { object: obj.name, index }
  const links = actionLinks(action)
  const span = action.end - action.start
  const props = action.stmt?.props ?? action.classAction?.stmt?.props ?? []
  const raw = (key: string): string | undefined => props.find((p) => p.key === key)?.raw.trim()
  const ease = action.timing.ease
  const easeMode = typeof ease === 'function' ? CUSTOM : typeof ease === 'string' && (EASE_NAMES as readonly string[]).includes(ease) ? ease : RAMPS
  const easeIn = action.timing.easeIn ?? span * 0.3
  const easeOut = action.timing.easeOut ?? span * 0.3
  const minimum = frameSeconds(fps)
  const changes = Object.entries(action.changes)
  const timingNumber = (key: string, value: number | undefined, fallback: number, status: ReactNode, write: (v: number | null) => void, opts: { min?: number; max?: number; step?: number; slider?: boolean; title?: string } = {}) => {
    const link = links.find((l) => l.key === key)
    return (
      <Row key={key} name={key} status={link ? 'linked' : status} className={value === undefined && !link ? 'default' : ''}>
        {link ? (
          <Linked expr={link.text} shown={formatValue(value ?? fallback)} disabled={locked} isTime onCommit={(t) => t.trim() && setActionProp(ref, key, t.trim(), true)} onBake={() => bakeActionProp(ref, key)} />
        ) : (
          <span className="now-control">
            {opts.slider && <Slider value={value ?? fallback} min={opts.min ?? 0} max={opts.max ?? 1} step={opts.step ?? 0.01} disabled={locked} onChange={(v) => write(v)} />}
            <Commit
              value={formatValue(value ?? fallback)}
              type="number"
              step={opts.step ?? 0.1}
              min={opts.min}
              max={opts.max}
              disabled={locked}
              title={opts.title}
              onCommit={(text) => {
                const num = parse(text)
                if (num !== null) write(num)
                else if (text.trim()) setActionProp(ref, key, text.trim(), true)
                else write(null)
              }}
            />
          </span>
        )}
      </Row>
    )
  }
  const timeRow = (key: 'at' | 'until', label: string, value: number, status: ReactNode) => {
    const link = links.find((l) => l.key === key)
    return (
      <Row key={key} name={label} status={link ? 'linked' : status} onLink={locked ? undefined : () => openLinks(key)} linkTitle={`Link the ${label.toLowerCase()} to something else`}>
        {link ? (
          <Linked expr={link.text} shown={timecode(value, fps)} disabled={locked} isTime onCommit={(t) => t.trim() && setActionProp(ref, key, t.trim(), true)} onBake={() => bakeActionProp(ref, key)} />
        ) : (
          <span className="now-control">
            <Commit
              value={formatValue(roundSeconds(value))}
              type="number"
              step={0.1}
              min={0}
              disabled={locked}
              title={`${label}: seconds, or a time such as slide.end`}
              onCommit={(text) => {
                const num = parse(text)
                if (num === null) {
                  if (text.trim()) setActionProp(ref, key, text.trim(), true)
                  return
                }
                if (key === 'at') setActionProp(ref, 'at', Math.max(0, num) - (action.timing.delay ?? 0))
                else setActionProp(ref, 'until', Math.max(action.start + minimum, num))
              }}
            />
          </span>
        )}
      </Row>
    )
  }
  return (
    <div className="now-values">
      <div className="now-head">
        <span className="name">
          {obj.name}.{action.verb}
        </span>
        {action.name && <span className="ident">{action.name}</span>}
        <span className="dim">
          <button className="time-link" title="Go to the start" onClick={() => useStore.getState().setTime(action.start)}>
            {timecode(action.start, fps)}
          </button>{' '}
          to{' '}
          <button className="time-link" title="Go to the end" onClick={() => useStore.getState().setTime(action.end)}>
            {timecode(action.end, fps)}
          </button>
          , {roundSeconds(span)} s
        </span>
        {derived && <span className="badge">from all('{action.classAction!.className}')</span>}
        {action.overridden && <span className="badge off">off</span>}
      </div>
      {derived && <div className="now-note dim">This animation comes from a class statement. Right-click it and choose Override to edit it for {obj.name} only, or edit the class statement in the code.</div>}
      <table>
        <tbody>
          <tr className="now-section">
            <td colSpan={4}>{action.timing.relative ? 'Changes by' : 'Goes to'}</td>
          </tr>
          {changes.map(([key, value]) => {
            const attr = schema?.attrs.find((a) => a.name === key)
            const isPivot = (PIVOT_PARAMS as readonly string[]).includes(key)
            const type: AttrType = attr?.type ?? (typeof value === 'number' ? 'number' : typeof value === 'string' ? 'string' : 'boolean')
            const label = isPivot ? `${key} (pivot)` : key
            const morphTarget = key === 'to' && action.verb === 'morph'
            if (key === 'shape' || key === 'offset' || key === 'points' || morphTarget) {
              // A path's shape and its offset are written as code: points [[x, y], ...] or a function of the progress, and [dx, dy] (D192); a morph's target the same, curves or points (D257).
              const shape = key === 'shape' ? pathShape(model, action, action.start) : null
              // Curves, SVG path data, count their anchors (D246).
              const curves = key === 'shape' ? pathCurves(action) : morphTarget && hasPathData(value) ? parsePathData(value) : null
              const status = morphTarget
                ? curves
                  ? `${pathAnchors(curves).length} anchors`
                  : Array.isArray(value)
                    ? `${value.length} points`
                    : typeof value === 'function'
                      ? 'linked'
                      : 'none'
                : key !== 'shape'
                  ? ''
                  : curves
                    ? `${pathAnchors(curves).length} anchors`
                    : shape?.kind === 'points'
                      ? `${shape.points.length} ${shape.points.length === 1 ? 'point' : 'points'}`
                      : shape
                        ? 'function'
                        : 'none'
              return (
                <Row key={key} name={key} status={status}>
                  <Commit
                    value={(curves ? String(action.changes[key]) : (raw(key) ?? '')).replace(/\s+/g, ' ')}
                    disabled={locked}
                    title={
                      key === 'shape'
                        ? "The shape: points [[x, y], ...] in the scene's space, curves 'M 0 0 C ...', or a function of the progress, (p) => [x, y]"
                        : morphTarget
                          ? "The target outline: curves 'M 0 0 C ...', points [[x, y], ...], a word such as Shape.star(5, 100, 50), or a link such as () => other.curves"
                          : 'A shift of the whole path, [dx, dy]'
                    }
                    onCommit={(t) => {
                      const text = t.trim()
                      if (!text) setActionProp(ref, key, null)
                      else if ((key === 'shape' || morphTarget) && /^[MmLlHhVvCcSsQqTtAaZz][\s\d.,-]/.test(text)) setActionProp(ref, key, text)
                      else setActionProp(ref, key, text, true)
                    }}
                  />
                </Row>
              )
            }
            if (typeof value === 'function') {
              return (
                <Row key={key} name={label} status="linked" onLink={locked ? undefined : () => openLinks(key)} linkTitle={`Link ${key} to something else`}>
                  <Linked expr={linkBody(raw(key) ?? '')} shown={formatValue(valueAt(model, obj, key, action.end))} disabled={locked} onCommit={(t) => t.trim() && setActionProp(ref, key, asLink(t), true)} onBake={() => bakeActionProp(ref, key)} />
                </Row>
              )
            }
            const from = action.from[key]
            if (typeof from === 'number' && typeof value === 'number') {
              // Written as a range, `[from, to]`: where it begins and where it goes, each its own number (D221).
              const write = (part: 'from' | 'to') => (text: string) => {
                const n = parse(text)
                if (n !== null) part === 'from' ? setActionFrom(ref, key, n) : setActionProp(ref, key, n)
                else if (text.trim() && part === 'to') setActionProp(ref, key, text.trim(), true)
              }
              return (
                <Row key={key} name={label} status={action.timing.relative ? 'from, to: changes' : 'from, to'} onLink={locked ? undefined : () => openLinks(key)} linkTitle={`Link ${key} to something else`}>
                  <span className="now-control now-range">
                    <Commit value={formatValue(from)} type="number" step={stepFor(key)} disabled={locked} title={`Where ${key} begins`} onCommit={write('from')} />
                    <span className="dim">→</span>
                    <Commit value={formatValue(value)} type="number" step={stepFor(key)} disabled={locked} title={`Where ${key} ends`} onCommit={write('to')} />
                  </span>
                </Row>
              )
            }
            return (
              <Row key={key} name={label} status={isPivot ? 'pivot' : ''} onLink={locked ? undefined : () => openLinks(key)} linkTitle={`Link ${key} to something else`}>
                <Field type={type} name={key} value={value as AttrValue} model={model} disabled={locked} doc={attr?.doc} range={RANGES[key]} step={stepFor(key)} onValue={(v) => setActionProp(ref, key, v)} onCode={(text) => setActionProp(ref, key, text, true)} />
              </Row>
            )
          })}
          {changes.length === 0 && (
            <Row name="" status="">
              <span className="dim">nothing yet</span>
            </Row>
          )}
          <tr className="now-section">
            <td colSpan={4}>Timing</td>
          </tr>
          {timeRow('at', 'Start', action.start, action.timing.at === undefined ? 'after the one before' : '')}
          {action.timing.until !== undefined
            ? timeRow('until', 'End', action.end, '')
            : timingNumber('duration', action.timing.duration, 1, action.timing.duration === undefined ? 'default' : '', (v) => v !== null && setActionProp(ref, 'duration', Math.max(minimum, v)), { min: minimum, step: 0.1, title: 'Seconds, or code' })}
          {timingNumber('delay', action.timing.delay, 0, action.timing.delay === undefined ? 'default' : '', (v) => setActionProp(ref, 'delay', v === null || v <= 0 ? null : Math.max(0, v)), { min: 0, step: 0.1, title: 'Seconds after the start before it moves, or code' })}
          {timingNumber('hold', action.timing.hold, 0, action.timing.return === undefined ? 'with return' : action.timing.hold ? '' : 'default', (v) => setActionProp(ref, 'hold', v === null || v <= 0 ? null : Math.max(0, v)), { min: 0, step: 0.1, title: 'Seconds the change is held once reached, before the return' })}
          {timingNumber('return', action.timing.return, 0, action.timing.return === undefined ? 'keeps' : '', (v) => setActionProp(ref, 'return', v === null ? null : Math.max(0, v)), { min: 0, step: 0.1, title: 'Seconds over which the animation goes back to what it found; empty, the change keeps' })}
          <Row name="ease" status={ease === undefined ? 'default' : ''}>
            <span className="now-control">
              <select
                className="now-select"
                value={easeMode}
                disabled={locked}
                onChange={(e) => {
                  const mode = e.target.value
                  if (mode === RAMPS) setActionProp(ref, 'ease', null)
                  else if (mode === CUSTOM) setActionProp(ref, 'ease', '(p) => p * p', true)
                  else setActionProp(ref, 'ease', mode)
                }}
                title="Ramps, a named curve, or a function"
              >
                <option value={RAMPS}>ramps</option>
                {EASE_NAMES.map((name) => (
                  <option key={name} value={name}>
                    {name}
                  </option>
                ))}
                <option value={CUSTOM}>custom</option>
              </select>
              {easeMode === CUSTOM && <Commit value={raw('ease') ?? ''} disabled={locked} title="A function of the progress, 0 to 1" onCommit={(t) => t.trim() && setActionProp(ref, 'ease', t.trim(), true)} />}
            </span>
          </Row>
          {easeMode === RAMPS && timingNumber('easeIn', action.timing.easeIn, easeIn, action.timing.easeIn === undefined ? 'default' : '', (v) => setActionProp(ref, 'easeIn', v === null ? null : Math.max(0, v)), { min: 0, max: span, step: 0.01, slider: true, title: 'Seconds to get up to speed' })}
          {easeMode === RAMPS && timingNumber('easeOut', action.timing.easeOut, easeOut, action.timing.easeOut === undefined ? 'default' : '', (v) => setActionProp(ref, 'easeOut', v === null ? null : Math.max(0, v)), { min: 0, max: span, step: 0.01, slider: true, title: 'Seconds to slow down at the end' })}
          <Row name="relative" status={action.timing.relative ? '' : 'default'}>
            <input type="checkbox" checked={!!action.timing.relative} disabled={locked} onChange={(e) => setActionProp(ref, 'relative', e.target.checked ? true : null)} title="Adds its values on top of everything else" />
          </Row>
          {obj.className === 'Text' && action.timing.units && (
            <Row name="by" status="by handle">
              <span className="dim">
                {action.timing.by} {action.timing.units.join(', ')}
              </span>
            </Row>
          )}
          {obj.className === 'Text' && action.verb !== 'path' && action.verb !== 'morph' && !action.timing.units && (
            <Row name="by" status={action.timing.by ? '' : 'default'}>
              <select className="now-select" value={action.timing.by ?? 'whole'} disabled={locked} onChange={(e) => setActionProp(ref, 'by', e.target.value === 'whole' ? null : e.target.value)} title="Whole, or each character, word, or line in turn">
                <option value="whole">whole</option>
                {UNIT_KINDS.map((kind) => (
                  <option key={kind} value={kind}>
                    {kind}
                  </option>
                ))}
              </select>
            </Row>
          )}
          {action.timing.by && typeof action.timing.stagger === 'function' ? (
            <Row name="stagger" status="by index">
              <Commit value={raw('stagger') ?? ''} disabled={locked} title="Seconds before each unit, or a function of its index" onCommit={(t) => t.trim() && setActionProp(ref, 'stagger', t.trim(), true)} />
            </Row>
          ) : (
            action.timing.by && timingNumber('stagger', typeof action.timing.stagger === 'number' ? action.timing.stagger : undefined, DEFAULT_STAGGER, action.timing.stagger === undefined ? 'default' : '', (v) => setActionProp(ref, 'stagger', v === null ? null : Math.max(0, v)), { min: 0, step: 0.01, title: 'Seconds between one unit and the next, or code: a function of the index' })
          )}
          {action.overrides && (
            <Row name="overrides" status="">
              <span className="mono">{action.overrides.name ?? `all('${action.overrides.className}')`}</span>
            </Row>
          )}
        </tbody>
      </table>
    </div>
  )
}
