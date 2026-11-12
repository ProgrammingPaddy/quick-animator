import type { ReactNode } from 'react'

interface PaneProps {
  title: string
  side: 'left' | 'right' | 'bottom' | 'now' | 'center' | 'presets'
  collapsed: boolean
  onToggle?: () => void
  /** What the pane's header holds beside its title, such as the preview's views (D359). */
  extra?: ReactNode
  children: ReactNode
}

const COLLAPSE_GLYPH = { left: '◂', right: '▸', bottom: '▾', now: '▾', presets: '▾', center: '' } as const

/** A titled pane. Collapsed, it becomes a thin strip that expands on click. */
export function Pane({ title, side, collapsed, onToggle, extra, children }: PaneProps) {
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
        {extra}
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
