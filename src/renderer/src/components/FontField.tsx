import { useEffect, useMemo, useRef, useState } from 'react'

/**
 * A font family field that narrows as you type (D271): the families that contain what is typed,
 * those that begin with it first, each shown in its own face; the arrows move through them,
 * Enter takes one, Escape gives up, and a click away keeps what is typed. Any family name is
 * accepted, listed or not.
 */
export function FontField({ value, options, disabled, placeholder, title, compact, onCommit }: { value: string; options: readonly string[]; disabled?: boolean; placeholder?: string; title?: string; compact?: boolean; onCommit: (family: string) => void }) {
  const [draft, setDraft] = useState(value)
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(0)
  const listRef = useRef<HTMLUListElement>(null)
  /** The draft as typed, for the blur that follows a choice or an escape, which must not write the field's text over it. */
  const draftRef = useRef(value)
  const settled = useRef(false)
  useEffect(() => {
    setDraft(value)
    draftRef.current = value
  }, [value])
  const matches = useMemo(() => {
    const q = draft.trim().toLowerCase()
    const found = q === '' ? [...options] : options.filter((o) => o.toLowerCase().includes(q))
    if (q !== '') found.sort((a, b) => Number(!a.toLowerCase().startsWith(q)) - Number(!b.toLowerCase().startsWith(q)))
    return found.slice(0, 80)
  }, [draft, options])
  useEffect(() => {
    const el = listRef.current?.children[active] as HTMLElement | undefined
    el?.scrollIntoView({ block: 'nearest' })
  }, [active, open])
  const commit = (family: string) => {
    setOpen(false)
    settled.current = true
    const next = family.trim()
    setDraft(next || value)
    draftRef.current = next || value
    if (next && next !== value) onCommit(next)
  }
  const giveUp = () => {
    setOpen(false)
    settled.current = true
    setDraft(value)
    draftRef.current = value
  }
  return (
    <span className={`font-field${compact ? ' compact' : ''}`}>
      <input
        className="now-input text"
        type="text"
        role="combobox"
        aria-expanded={open}
        aria-autocomplete="list"
        disabled={disabled}
        placeholder={placeholder}
        title={title}
        value={draft}
        onChange={(e) => {
          setDraft(e.target.value)
          draftRef.current = e.target.value
          settled.current = false
          setOpen(true)
          setActive(0)
        }}
        onFocus={() => {
          settled.current = false
          setOpen(true)
        }}
        onBlur={() => {
          // A choice or an escape has settled the field already; else what was typed is kept.
          if (settled.current) return
          commit(draftRef.current)
        }}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
            e.preventDefault()
            if (!open) setOpen(true)
            else setActive((a) => Math.max(0, Math.min(matches.length - 1, a + (e.key === 'ArrowDown' ? 1 : -1))))
          } else if (e.key === 'Enter') {
            e.preventDefault()
            commit(open && matches[active] !== undefined ? matches[active]! : draftRef.current)
            e.currentTarget.blur()
          } else if (e.key === 'Escape') {
            e.preventDefault()
            giveUp()
            e.currentTarget.blur()
          } else if (e.key === 'Tab') setOpen(false)
        }}
      />
      {open && matches.length > 0 && (
        <ul className="font-list" role="listbox" ref={listRef}>
          {matches.map((m, i) => (
            <li
              key={m}
              role="option"
              aria-selected={i === active}
              className={i === active ? 'active' : ''}
              style={{ fontFamily: `"${m}"` }}
              onMouseDown={(e) => {
                // Before the input's blur, so the choice is what is kept.
                e.preventDefault()
                commit(m)
              }}
              onMouseEnter={() => setActive(i)}
            >
              {m}
            </li>
          ))}
        </ul>
      )}
    </span>
  )
}
