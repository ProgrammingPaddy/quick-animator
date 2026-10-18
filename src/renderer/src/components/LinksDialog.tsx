import { useEffect, useMemo, useRef, useState } from 'react'
import { actionLinks, objectLinks } from '../model/links'
import { GROUP, schemaOf, type AttrType } from '../model/registry'
import { stateStretches, valueAt } from '../model/sample'
import { STATE_DIRECTIONS, STATE_NAMES } from '../model/types'
import { BakeIcon } from './BakeIcon'
import { bakeActionProp, bakeObjectProp, linkAction, linkLifetime, restoreActionProp, restoreObjectProp, roundSeconds, setActionProp, setObjectProp, unlinkAction, unlinkLifetime, type LinkPart, type LinkTarget } from '../project/operations'
import { useStore, type LinksTarget } from '../state/store'
import { timecode } from '../state/time'

/** One thing to pick under a row: a moment or an attribute of the target. */
interface Part {
  label: string
  apply: () => void
}

interface Group {
  label: string
  parts: Part[]
}

/** An object's states under headings, each opening to its stretches (D212); shown only when the row is open, so the list stays short. */
function StateGroups({ groups, slotLabel, owner }: { groups: Group[]; slotLabel: string; owner: string }) {
  const [openGroup, setOpenGroup] = useState<string | null>(null)
  if (groups.length === 0) return null
  return (
    <div className="links-groups">
      <div className="links-group-heads">
        <span className="dim">while</span>
        {groups.map((g) => (
          <button key={g.label} className={`small${openGroup === g.label ? ' on' : ''}`} onClick={() => setOpenGroup(openGroup === g.label ? null : g.label)} aria-expanded={openGroup === g.label}>
            {g.label}
          </button>
        ))}
      </div>
      {openGroup !== null && (
        <div className="links-parts">
          {groups
            .find((g) => g.label === openGroup)
            ?.parts.map((p) => (
              <button key={p.label} className="small" onClick={p.apply} title={`${slotLabel} follows ${owner} ${openGroup} ${p.label}`}>
                {p.label}
              </button>
            ))}
        </div>
      )}
    </div>
  )
}

export function LinksDialogLayer() {
  const target = useStore((s) => s.linksDialog)
  if (!target) return null
  return <LinksDialog target={target} />
}

/** One thing of the subject that can follow something else: a time, or a value with its type (D182). */
interface Slot {
  key: string
  label: string
  kind: 'time' | 'value'
  type: AttrType | null
  current: string
  linked: boolean
}

/** One thing in the scene a slot can follow (D230): its moments, its attributes, and for an object its states, worked out when the row opens. */
interface TargetRow {
  key: string
  kind: 'object' | 'group' | 'class' | 'animation'
  label: string
  /** How it is named in a tooltip: its name, or what it is when it has none. */
  short: string
  detail: string
  times: Part[]
  /** The target's attributes, with their types, for a value slot; `null` when it has none to offer. */
  values: { name: string; type: AttrType }[] | null
  groups?: () => Group[]
}

/** Never a link target: lifetimes and name lists live elsewhere, and a link to itself would chase its own tail. */
const NOT_LINKABLE = new Set(['at', 'until', 'class', 'members'])

function formatShown(value: unknown): string {
  if (typeof value === 'number') return String(Math.round(value * 100) / 100)
  if (value === undefined || value === null) return ''
  return String(value)
}

/**
 * The links of one animation or object (D172, D182, D230): on the left everything of it that can
 * follow something else, its start and end, then each attribute, with what it is now and Unlink;
 * on the right a searchable list of the objects, groups, classes, and animations, each opening to
 * its moments and its attributes. What fits the chosen slot links at once; the rest is dimmed and
 * switches to the slot it fits. Opened on a linked slot, the row of what it follows is open.
 */
function LinksDialog({ target }: { target: LinksTarget }) {
  const close = useStore((s) => s.closeLinksDialog)
  const model = useStore((s) => s.model)
  const fps = useStore((s) => s.settings.fps)
  const time = useStore((s) => s.time)
  const [slotKey, setSlotKey] = useState<string>(target.key ?? 'at')
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState<string | null>(null)
  const searchRef = useRef<HTMLInputElement>(null)
  const openedFor = useRef<string | null>(null)
  const obj = model?.objects.find((o) => o.name === target.object)
  const action = target.index !== undefined ? obj?.actions[target.index] : undefined
  const gone = !model || !obj || (target.index !== undefined && !action)

  useEffect(() => {
    const handle = setTimeout(() => searchRef.current?.focus(), 0)
    return () => clearTimeout(handle)
  }, [])
  useEffect(() => {
    if (gone) close()
  }, [gone, close])
  useEffect(() => {
    setSlotKey(target.key ?? 'at')
  }, [target])

  const slots = useMemo<Slot[]>(() => {
    if (!model || !obj || gone) return []
    if (action) {
      const links = actionLinks(action)
      const schema = schemaOf(obj.className)
      const out: Slot[] = [
        { key: 'at', label: 'start', kind: 'time', type: null, current: links.find((l) => l.key === 'at')?.text ?? timecode(action.start, fps), linked: links.some((l) => l.key === 'at') },
        { key: 'until', label: 'end', kind: 'time', type: null, current: links.find((l) => l.key === 'until')?.text ?? `${timecode(action.end, fps)}, ${roundSeconds(action.end - action.start)} s`, linked: links.some((l) => l.key === 'until') },
      ]
      const props = action.stmt?.props ?? []
      for (const [key, value] of Object.entries(action.changes)) {
        const type = schema?.attrs.find((a) => a.name === key)?.type ?? (typeof value === 'number' ? 'number' : 'string')
        const fn = typeof value === 'function'
        out.push({ key, label: key, kind: 'value', type, current: fn ? (props.find((p) => p.key === key)?.raw.trim() ?? 'code') : formatShown(value), linked: fn })
      }
      return out
    }
    const links = objectLinks(obj)
    const out: Slot[] = [
      { key: 'at', label: 'start', kind: 'time', type: null, current: links.find((l) => l.key === 'at')?.text ?? (obj.at > 0 ? timecode(obj.at, fps) : 'the beginning'), linked: links.some((l) => l.key === 'at') },
      { key: 'until', label: 'end', kind: 'time', type: null, current: links.find((l) => l.key === 'until')?.text ?? (obj.until === null ? 'the end' : timecode(obj.until, fps)), linked: links.some((l) => l.key === 'until') },
    ]
    for (const attr of schemaOf(obj.className)?.attrs ?? []) {
      if (NOT_LINKABLE.has(attr.name)) continue
      const link = links.find((l) => l.key === attr.name)
      out.push({ key: attr.name, label: attr.name, kind: 'value', type: attr.type, current: link ? link.text : formatShown(valueAt(model, obj, attr.name, time)), linked: !!link })
    }
    return out
  }, [model, obj, action, gone, fps, time])

  const slot = slots.find((s) => s.key === slotKey) ?? slots[0]

  const rows = useMemo<TargetRow[]>(() => {
    if (!model || !obj || gone || !slot) return []
    const ref = target.index !== undefined ? { object: obj.name, index: target.index } : null
    const writeTime = (t: LinkTarget, part: LinkPart) => {
      if (ref) linkAction(ref, slot.key as 'at' | 'until', t, part)
      else linkLifetime(obj.name, slot.key as 'at' | 'until', t, part)
    }
    const writeText = (text: string) => {
      if (ref) setActionProp(ref, slot.key, text, true)
      else setObjectProp(obj.name, slot.key, text, true)
    }
    const times = (t: LinkTarget): Part[] => [
      { label: 'start', apply: () => writeTime(t, 'start') },
      { label: 'halfway', apply: () => writeTime(t, 'progress') },
      { label: 'end', apply: () => writeTime(t, 'end') },
    ]
    const out: TargetRow[] = []
    for (const o of model.objects) {
      // An animation may follow its own object's life, never its own object's values.
      const self = o.name === obj.name
      if (!o.decl || (self && ref === null)) continue
      const isGroup = o.className === GROUP
      const values = self ? [] : (schemaOf(o.className)?.attrs ?? []).filter((a) => !NOT_LINKABLE.has(a.name)).map((a) => ({ name: a.name, type: a.type }))
      // What the object is doing, as stretches to pick a moment of (D212): written as text, since the reference names the state.
      const groups = () => {
        const found: Group[] = []
        for (const name of STATE_NAMES) {
          for (const direction of [undefined, ...(STATE_DIRECTIONS[name] ?? [])]) {
            const stretches = stateStretches(model, o, name, direction, fps)
            if (stretches.length === 0) continue
            const what = `${name}${direction ? `.${direction}` : ''}`
            const parts = stretches.flatMap((s, i) => {
              const which = i === 0 ? '' : `[${i + 1}]`
              return [
                { label: `${i + 1} start ${timecode(s.start, fps)}`, apply: () => writeText(`${o.name}.${what}${which}.start`) },
                { label: `${i + 1} end ${timecode(s.end, fps)}`, apply: () => writeText(`${o.name}.${what}${which}.end`) },
              ]
            })
            if (stretches.length > 1) parts.push({ label: 'last end', apply: () => writeText(`${o.name}.${what}.last.end`) })
            found.push({ label: `${what.replace('.', ' ')} (${stretches.length})`, parts })
          }
        }
        return found
      }
      out.push({
        key: `o:${o.name}`,
        kind: isGroup ? 'group' : 'object',
        label: o.name,
        short: o.name,
        detail: isGroup ? o.className : `${o.className}, ${timecode(o.at, fps)} to ${o.until === null ? 'the end' : timecode(o.until, fps)}`,
        times: isGroup ? [] : [{ label: 'start', apply: () => writeTime({ object: o.name }, 'start') }, { label: 'end', apply: () => writeTime({ object: o.name }, 'end') }],
        values: values.length > 0 ? values : null,
        groups: isGroup ? undefined : groups,
      })
    }
    for (const c of model.classActions) {
      if (!c.stmt) continue
      out.push({ key: `c:${c.id}`, kind: 'class', label: `${c.name ? `${c.name}: ` : ''}all('${c.className}').${c.verb}`, short: c.name ?? `all('${c.className}').${c.verb}`, detail: `${c.members.length} members`, times: times({ classAction: c.id }), values: null })
    }
    for (const o of model.objects) {
      o.actions.forEach((a, i) => {
        if (!a.stmt || a.classAction || a.overridden || (ref && ref.object === o.name && ref.index === i)) return
        out.push({ key: `a:${a.id}`, kind: 'animation', label: `${a.name ? `${a.name}: ` : ''}${o.name}.${a.verb}`, short: a.name ?? `${o.name}.${a.verb}`, detail: `${timecode(a.start, fps)} to ${timecode(a.end, fps)}`, times: times({ action: { object: o.name, index: i } }), values: null })
      })
    }
    const q = query.trim().toLowerCase()
    return q ? out.filter((r) => `${r.kind} ${r.label} ${r.detail}`.toLowerCase().includes(q)) : out
  }, [model, obj, gone, slot, target.index, fps, query])

  // Opened on a linked slot, the row of what it follows is open (D230): the first name in the reference.
  useEffect(() => {
    if (!slot?.linked || openedFor.current === slot.key) return
    openedFor.current = slot.key
    const ident = /^[A-Za-z_$][\w$]*/.exec(slot.current)?.[0]
    if (!ident) return
    const row = rows.find((r) => (r.kind === 'object' || r.kind === 'group' ? r.label === ident : r.label === ident || r.label.startsWith(`${ident}:`)))
    if (row) setOpen(row.key)
  }, [slot, rows])

  if (gone || !obj || !model || !slot) return null
  const isAction = !!action
  const derived = isAction && !!action.classAction
  const ref = target.index !== undefined ? { object: obj.name, index: target.index } : null
  const firstTime = slots.find((s) => s.kind === 'time')
  // Unlink puts back what the link replaced, or the default; bake keeps what the link comes to (D189).
  const unlink = (s: Slot) => {
    if (s.kind === 'time') {
      if (ref) unlinkAction(ref, s.key as 'at' | 'until')
      else unlinkLifetime(obj.name, s.key as 'at' | 'until')
    } else if (ref) restoreActionProp(ref, s.key)
    else restoreObjectProp(obj.name, s.key)
  }
  const bake = (s: Slot) => {
    if (ref) bakeActionProp(ref, s.key)
    else bakeObjectProp(obj.name, s.key, time)
  }
  const writeValue = (name: string, attr: string) => {
    const code = `() => ${name}.${attr}`
    if (ref) setActionProp(ref, slot.key, code, true)
    else setObjectProp(obj.name, slot.key, code, true)
  }
  return (
    <div
      className="dialog-backdrop"
      onPointerDown={(e) => {
        if (e.target === e.currentTarget) close()
      }}
    >
      <div
        className="dialog links-dialog"
        role="dialog"
        aria-modal="true"
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            e.preventDefault()
            close()
          }
        }}
      >
        <div className="dialog-title">
          Links of {isAction ? `${obj.name}.${action.verb}` : obj.name}
          {action?.name ? <span className="dim"> {action.name}</span> : null}
        </div>
        {derived ? (
          <div className="dialog-note dim">From all('{action.classAction!.className}'): override it to link it.</div>
        ) : (
          <div className="links-grid">
            <div className="links-slots" role="radiogroup" aria-label="What to link">
              {slots.map((s) => (
                <label key={s.key} className={`links-slot${slot.key === s.key ? ' active' : ''}`}>
                  <input type="radio" name="links-slot" checked={slot.key === s.key} onChange={() => setSlotKey(s.key)} />
                  <span className="k">{s.label}</span>
                  <span className={`v mono${s.linked ? ' linked' : ''}`}>{s.current}</span>
                  {s.linked && (
                    <>
                      <button
                        className="small"
                        onClick={(e) => {
                          e.preventDefault()
                          unlink(s)
                        }}
                        title="Unlink"
                      >
                        Unlink
                      </button>
                      <button
                        className="small bake-button"
                        onClick={(e) => {
                          e.preventDefault()
                          bake(s)
                        }}
                        title="Bake: keep the value, drop the link"
                      >
                        <BakeIcon />
                      </button>
                    </>
                  )}
                </label>
              ))}
            </div>
            <div className="links-targets">
              <input ref={searchRef} className="links-search" placeholder="Search" value={query} onChange={(e) => setQuery(e.target.value)} aria-label="Search" />
              <div className="links-list">
                {rows.length === 0 && <div className="dim">Nothing matches.</div>}
                {rows.map((r) => {
                  const timesFit = slot.kind === 'time'
                  return (
                    <div key={r.key} className={`links-row${open === r.key ? ' open' : ''}`}>
                      <button className="links-what" onClick={() => setOpen(open === r.key ? null : r.key)} aria-expanded={open === r.key}>
                        <span className="caret">{open === r.key ? '▾' : '▸'}</span>
                        <span className="kind dim">{r.kind}</span> {r.label} <span className="dim mono">{r.detail}</span>
                      </button>
                      {open === r.key && (
                        <>
                          {(r.times.length > 0 || r.values) && (
                            <div className="links-parts">
                              {r.times.map((p) =>
                                timesFit ? (
                                  <button key={p.label} className="small" onClick={p.apply} title={`${slot.label} follows ${r.short} ${p.label}`}>
                                    {p.label}
                                  </button>
                                ) : (
                                  firstTime && (
                                    <button key={p.label} className="small dimmed" onClick={() => setSlotKey(firstTime.key)} title={`Switch to ${firstTime.label}`}>
                                      {p.label}
                                    </button>
                                  )
                                ),
                              )}
                              {r.values?.map((v) => {
                                const fits = slot.kind === 'value' && slot.type === v.type
                                const other = fits ? null : slots.find((s) => s.kind === 'value' && s.key === v.name && s.type === v.type)
                                if (!fits && !other) return null
                                return fits ? (
                                  <button key={v.name} className="small" onClick={() => writeValue(r.short, v.name)} title={`${slot.label} follows ${r.short}.${v.name}`}>
                                    {v.name}
                                  </button>
                                ) : (
                                  <button key={v.name} className="small dimmed" onClick={() => setSlotKey(other!.key)} title={`Switch to ${other!.label}`}>
                                    {v.name}
                                  </button>
                                )
                              })}
                            </div>
                          )}
                          {timesFit && r.groups && <StateGroups groups={r.groups()} slotLabel={slot.label} owner={r.label} />}
                        </>
                      )}
                    </div>
                  )
                })}
              </div>
            </div>
          </div>
        )}
        <div className="dialog-actions">
          <button className="primary" onClick={close}>
            Done
          </button>
        </div>
      </div>
    </div>
  )
}
