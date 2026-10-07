import type { ReactNode } from 'react'

interface PaneProps {
  title: string
  side: 'left' | 'right' | 'bottom' | 'now' | 'center'
  collapsed: boolean
  onToggle?: () => void
  children: ReactNode
}

const COLLAPSE_GLYPH = { left: '◂', right: '▸', bottom: '▾', now: '▾', center: '' } as const

/** A titled pane. Collapsed, it becomes a thin strip that expands on click. */
export function Pane({ title, side, collapsed, onToggle, children }: PaneProps) {
  if (collapsed) {
    return (
      <div className={`pane collapsed ${side}`}>
        <button className="strip" onClick={onToggle} title={`Expand ${title}`}>
          <span className="strip-title">{title}</span>
        </button>
      </div>
    )
  }
  return (
    <div className={`pane ${side}`}>
      <div className="pane-header">
        <span className="title">{title}</span>
        {onToggle && (
          <button className="icon" onClick={onToggle} title={`Collapse ${title}`} aria-label={`Collapse ${title}`}>
            {COLLAPSE_GLYPH[side]}
          </button>
        )}
      </div>
      <div className="pane-body">{children}</div>
    </div>
  )
}
