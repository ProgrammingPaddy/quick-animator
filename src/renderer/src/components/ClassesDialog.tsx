import { useEffect, useMemo, useRef, useState } from 'react'
import { classes as registry } from '../model/registry'
import type { SceneModel } from '../model/types'
import { applyClasses } from '../project/operations'
import { useStore } from '../state/store'

const NAME = /^[A-Za-z_][\w-]*$/
type Check = true | false | 'mixed'

/** The Classes dialog (D88): tick the classes the objects belong to, or create a new one. */
export function ClassesDialogLayer() {
  const names = useStore((s) => s.classesDialog)
  const model = useStore((s) => s.model)
  const close = useStore((s) => s.closeClassesDialog)
  if (!names || !model) return null
  return <ClassesDialog key={names.join('\u0000')} names={names} model={model} close={close} />
}

function ClassesDialog({ names, model, close }: { names: string[]; model: SceneModel; close: () => void }) {
  const objects = useMemo(() => model.objects.filter((o) => names.includes(o.name) && o.decl), [model, names])
  const known = useMemo(() => {
    const set = new Set<string>()
    for (const obj of model.objects) for (const c of obj.classes) set.add(c)
    for (const c of model.classes.keys()) if (!(c in registry)) set.add(c)
    return [...set].sort()
  }, [model])
  const [created, setCreated] = useState<string[]>([])
  const [checks, setChecks] = useState<Record<string, Check>>(() => {
    const out: Record<string, Check> = {}
    for (const c of known) {
      const count = objects.filter((o) => o.classes.includes(c)).length
      out[c] = count === objects.length ? true : count === 0 ? false : 'mixed'
    }
    return out
  })
  const [newName, setNewName] = useState('')
  const [note, setNote] = useState<string | null>(null)
  const [shaking, setShaking] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const all = [...known, ...created]

  useEffect(() => {
    const handle = setTimeout(() => inputRef.current?.focus(), 0)
    return () => clearTimeout(handle)
  }, [])

  const shake = (message: string) => {
    setNote(message)
    setShaking(true)
    setTimeout(() => setShaking(false), 450)
  }

  const create = () => {
    const name = newName.trim()
    if (!NAME.test(name)) return shake('Use letters, digits, dashes, and underscores.')
    if (name in registry) return shake(`${name} is a type: every ${name} is already in all('${name}').`)
    if (all.includes(name)) {
      setChecks((c) => ({ ...c, [name]: true }))
      return shake(`${name} already exists, so it is ticked instead.`)
    }
    setCreated((c) => [...c, name])
    setChecks((c) => ({ ...c, [name]: true }))
    setNewName('')
    setNote(null)
  }

  const apply = () => {
    close()
    applyClasses(
      names,
      all.filter((c) => checks[c] === true),
      all.filter((c) => checks[c] === false),
    )
  }

  const title = objects.length === 1 ? `Classes of ${objects[0]!.name}` : `Classes of ${objects.length} objects`
  return (
    <div
      className="dialog-backdrop"
      onPointerDown={(e) => {
        if (e.target === e.currentTarget) close()
      }}
    >
      <div
        className="dialog classes-dialog"
        role="dialog"
        aria-modal="true"
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            e.preventDefault()
            close()
          } else if (e.key === 'Enter' && e.target !== inputRef.current) {
            e.preventDefault()
            apply()
          }
        }}
      >
        <div className="dialog-title">{title}</div>
        <div className="dialog-message">Like CSS classes: an object can have several, and an action on all('name') applies to every member.</div>
        <ul className="dialog-items class-list">
          {all.length === 0 && <li className="dim">No classes yet. Create one below.</li>}
          {all.map((c) => (
            <li key={c}>
              <label>
                <input
                  type="checkbox"
                  checked={checks[c] === true}
                  ref={(el) => {
                    if (el) el.indeterminate = checks[c] === 'mixed'
                  }}
                  onChange={() => setChecks((prev) => ({ ...prev, [c]: prev[c] === true ? false : true }))}
                />
                <span className="mono">{c}</span>
                <span className="dim">{created.includes(c) ? 'new' : `${model.classes.get(c)?.length ?? 0} members`}</span>
              </label>
            </li>
          ))}
        </ul>
        <div className="dialog-input">
          <span>New class</span>
          <input
            ref={inputRef}
            value={newName}
            placeholder="name"
            spellCheck={false}
            autoComplete="off"
            onChange={(e) => {
              setNewName(e.target.value)
              setNote(null)
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault()
                e.stopPropagation()
                create()
              }
            }}
          />
          <button className={`small create${shaking ? ' shake' : ''}`} onClick={create}>
            Create
          </button>
        </div>
        {note && <div className="dialog-note">{note}</div>}
        <div className="dialog-actions">
          <button onClick={close}>Cancel</button>
          <button className="primary" onClick={apply}>
            Apply
          </button>
        </div>
      </div>
    </div>
  )
}
