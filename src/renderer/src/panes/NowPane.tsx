import { useEffect, useState, type ReactNode } from 'react'
import { beginGesture, endGesture } from '../code/editor'
import { BakeIcon } from '../components/BakeIcon'
import { LinkIcon } from '../components/LinkIcon'
import { actionLinks, objectLinks } from '../model/links'
import { EASE_NAMES, GROUP, PIVOT_PARAMS, schemaOf, type AttrSchema, type AttrType, type AttrValue } from '../model/registry'
import { basePivot, definingAction, isVisibleAt, pathShape, valueAt } from '../model/sample'
import type { Action, SceneModel, SceneObject } from '../model/types'
import { bakeActionProp, bakeObjectProp, canEdit, frameSeconds, roundSeconds, setActionProp, setAttrsAt, setLifetime, setObjectProp } from '../project/operations'
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

/** A text or number field that writes when it loses focus or Enter is pressed, and gives up on Escape. */
function Commit({ value, type = 'text', step, min, max, disabled, title, placeholder, onCommit }: { value: string; type?: 'text' | 'number'; step?: number; min?: number; max?: number; disabled?: boolean; title?: string; placeholder?: string; onCommit: (text: string) => void }) {
  const [draft, setDraft] = useState(value)
  useEffect(() => setDraft(value), [value])
  const commit = () => {
    if (draft !== value) onCommit(draft)
  }
  return (
    <input
      className={`now-input ${type}`}
      type="text"
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

/** A color well whose picking is one undo step. */
function ColorWell({ value, disabled, onChange }: { value: string; disabled?: boolean; onChange: (value: string) => void }) {
  const hex = /^#[0-9a-f]{6}$/i.test(value) ? value : '#ffffff'
  return <input className="now-color" type="color" value={hex} disabled={disabled} onFocus={() => beginGesture()} onBlur={() => endGesture()} onChange={(e) => onChange(e.target.value)} />
}

/** One row of the pane: a name, the control, the link button, and a word about where the value comes from. */
function Row({ name, status, children, className, onLink, linkTitle }: { name: string; status?: ReactNode; children: ReactNode; className?: string; onLink?: () => void; linkTitle?: string }) {
  return (
    <tr className={className}>
      <td className="k">{name}</td>
      <td className="v">{children}</td>
      <td className="l">
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
        <button className="small bake-button" onClick={onBake} disabled={disabled} title="Bake: keep what it comes to as the value, and drop the link">
          <BakeIcon />
        </button>
      )}
    </span>
  )
}

/** The control for a plain value by its type; typed code becomes a link (D174, D183). */
function Field({ type, name, value, model, disabled, doc, range, step, onValue, onCode }: { type: AttrType; name: string; value: AttrValue; model: SceneModel; disabled: boolean; doc?: string; range?: { min: number; max: number; step: number }; step?: number; onValue: (value: AttrValue) => void; onCode: (text: string) => void }) {
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
  return (
    <Commit
      value={String(value)}
      disabled={disabled}
      title={NAME_LISTS.has(name) ? `${doc ?? ''} Names separated by spaces.` : `${doc ?? ''} Words, or code such as title.text.`}
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
  const time = useStore((s) => s.time)
  const fps = useStore((s) => s.settings.fps)
  const openLinksDialog = useStore((s) => s.openLinksDialog)
  const editable = canEdit()
  const ref = selectedActions[0]
  const actionObj = model && ref ? model.objects.find((o) => o.name === ref.object) : undefined
  const action = actionObj && ref ? actionObj.actions[ref.index] : undefined
  if (model && actionObj && action && ref) return <ActionView model={model} obj={actionObj} action={action} index={ref.index} fps={fps} editable={editable} openLinks={(key) => openLinksDialog({ object: actionObj.name, index: ref.index, key })} />

  const obj = model && selection[0] ? model.objects.find((o) => o.name === selection[0]) : undefined
  const schema = obj ? schemaOf(obj.className) : undefined
  if (!model || !obj || !schema) {
    return <div className="empty">{selection.length === 0 ? 'Select something to see its values at the playhead.' : 'Nothing to show for this selection.'}</div>
  }
  return <ObjectView model={model} obj={obj} attrs={schema.attrs} time={time} editable={editable} openLinks={(key) => openLinksDialog({ object: obj.name, key })} />
}

function ObjectView({ model, obj, attrs, time, editable, openLinks }: { model: SceneModel; obj: SceneObject; attrs: AttrSchema[]; time: number; editable: boolean; openLinks: (key: string) => void }) {
  const visible = isVisibleAt(model, obj, time)
  const links = objectLinks(obj)
  const locked = !editable || obj.codeDriven || !obj.decl
  return (
    <div className="now-values">
      <div className="now-head">
        <span className="name">{obj.name}</span>
        <span className="dim">{obj.className}</span>
        <span className={`dim ${visible ? '' : 'hidden-now'}`}>
          {visible ? 'visible' : time < obj.at ? `does not exist until ${obj.at} s` : obj.until !== null && time >= obj.until ? `does not exist after ${obj.until} s` : 'not visible: opacity is 0'}
        </span>
        {obj.codeDriven && <span className="badge">code</span>}
      </div>
      <table>
        <tbody>
          {attrs.map((attr) => {
            const link = links.find((l) => l.key === attr.name)
            const isLife = attr.name === 'at' || attr.name === 'until'
            // A group's unset pivot is the center of its members' box at time zero (D124); an object's lifetime shows as resolved (D138).
            const value: AttrValue = obj.className === GROUP && (attr.name === 'pivotX' || attr.name === 'pivotY') && !(attr.name in obj.attrs) ? basePivot(model, obj)[attr.name === 'pivotX' ? 'x' : 'y'] : attr.name === 'at' ? obj.at : attr.name === 'until' ? (obj.until ?? 'end') : valueAt(model, obj, attr.name, time)
            const defining = definingAction(obj, attr.name, time)
            const status = link
              ? 'linked'
              : defining
                ? `${defining.name ? `${defining.name} ` : ''}${defining.verb}${defining.timing.relative ? ' (relative)' : ''}${defining.end > time ? ', in progress' : ', done'}`
                : attr.name in obj.attrs
                  ? ''
                  : 'default'
            const writeValue = (next: AttrValue | null) => {
              if (isLife) {
                if (attr.name === 'at') setLifetime(obj.name, { at: typeof next === 'number' ? next : null })
                else setLifetime(obj.name, { until: typeof next === 'number' ? next : null })
              } else if (typeof next === 'number' && attr.animatable && attr.type === 'number') setAttrsAt(obj.name, { [attr.name]: next }, time)
              else if (defining?.stmt && !defining.classAction && next !== null) setActionProp({ object: obj.name, index: obj.actions.indexOf(defining) }, attr.name, next)
              else setObjectProp(obj.name, attr.name, next === '' && NAME_LISTS.has(attr.name) ? null : next)
            }
            const writeCode = (text: string) => setObjectProp(obj.name, attr.name, text, true)
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
            } else {
              control = <Field type={attr.type} name={attr.name} value={value} model={model} disabled={locked} doc={attr.doc} range={RANGES[attr.name]} step={stepFor(attr.name)} onValue={writeValue} onCode={writeCode} />
            }
            return (
              <Row key={attr.name} name={attr.name} status={status} className={defining ? 'animated' : status === 'default' ? 'default' : ''} onLink={locked || NAME_LISTS.has(attr.name) ? undefined : () => openLinks(attr.name)} linkTitle={`Link ${attr.name} to something else`}>
                {control}
              </Row>
            )
          })}
        </tbody>
      </table>
    </div>
  )
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
              title={`${label}, in seconds, or a time reference such as slide.end`}
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
          {timecode(action.start, fps)} to {timecode(action.end, fps)}, {roundSeconds(span)} s
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
            if (key === 'shape' || key === 'offset') {
              // A path's shape and its offset are written as code: points [[x, y], ...] or a function of the progress, and [dx, dy] (D192).
              const shape = key === 'shape' ? pathShape(model, action, action.start) : null
              const status = key !== 'shape' ? '' : shape?.kind === 'points' ? `${shape.points.length} ${shape.points.length === 1 ? 'point' : 'points'}` : shape ? 'function' : 'none'
              return (
                <Row key={key} name={key} status={status}>
                  <Commit value={(raw(key) ?? '').replace(/\s+/g, ' ')} disabled={locked} title={key === 'shape' ? "The shape: points [[x, y], ...] in the scene's space, or a function of the progress, (p) => [x, y]" : 'A shift of the whole path, [dx, dy]'} onCommit={(t) => (t.trim() ? setActionProp(ref, key, t.trim(), true) : setActionProp(ref, key, null))} />
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
                title="The curve of the motion: ramps at each end, a named curve, or a function of your own"
              >
                <option value={RAMPS}>ramps</option>
                {EASE_NAMES.map((name) => (
                  <option key={name} value={name}>
                    {name}
                  </option>
                ))}
                <option value={CUSTOM}>custom</option>
              </select>
              {easeMode === CUSTOM && <Commit value={raw('ease') ?? ''} disabled={locked} title="A function of the progress, 0 to 1, giving the eased progress, 0 to 1" onCommit={(t) => t.trim() && setActionProp(ref, 'ease', t.trim(), true)} />}
            </span>
          </Row>
          {easeMode === RAMPS && timingNumber('easeIn', action.timing.easeIn, easeIn, action.timing.easeIn === undefined ? 'default' : '', (v) => setActionProp(ref, 'easeIn', v === null ? null : Math.max(0, v)), { min: 0, max: span, step: 0.01, slider: true, title: 'Seconds to get up to speed' })}
          {easeMode === RAMPS && timingNumber('easeOut', action.timing.easeOut, easeOut, action.timing.easeOut === undefined ? 'default' : '', (v) => setActionProp(ref, 'easeOut', v === null ? null : Math.max(0, v)), { min: 0, max: span, step: 0.01, slider: true, title: 'Seconds to slow down at the end' })}
          <Row name="relative" status={action.timing.relative ? '' : 'default'}>
            <input type="checkbox" checked={!!action.timing.relative} disabled={locked} onChange={(e) => setActionProp(ref, 'relative', e.target.checked ? true : null)} title="Values are changes from where the object is when it starts (D51)" />
          </Row>
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
