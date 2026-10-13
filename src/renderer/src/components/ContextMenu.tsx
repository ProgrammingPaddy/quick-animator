import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { useStore, type MenuItem } from '../state/store'

/** Open the right-click menu at a pointer event. */
export function showMenu(e: { clientX: number; clientY: number; preventDefault(): void }, items: MenuItem[]): void {
  e.preventDefault()
  if (items.length === 0) return
  useStore.getState().openMenu({ x: e.clientX, y: e.clientY, items })
}

function Label({ item }: { item: MenuItem }) {
  return (
    <span className="menu-label">
      {item.label}
      {item.keyword && (
        <>
          {' '}
          <span className="keyword" style={{ color: item.color }}>
            {item.keyword}
          </span>
        </>
      )}
    </span>
  )
}

const MARGIN = 8

/** Shift an element so it stays inside the window; `flip` swaps a submenu to the left side instead. */
function keepInside(el: HTMLElement, flip = false): void {
  el.style.transform = ''
  if (flip) {
    el.style.left = ''
    el.style.right = ''
  }
  const r = el.getBoundingClientRect()
  const dy = Math.min(0, window.innerHeight - MARGIN - r.bottom)
  let dx = Math.min(0, window.innerWidth - MARGIN - r.right)
  if (flip && dx < 0) {
    el.style.left = 'auto'
    el.style.right = '100%'
    dx = 0
  }
  el.style.transform = `translate(${dx}px, ${dy}px)`
}

/**
 * One level of the menu: the items, each with its flyout of children beside it on hover, any
 * number of levels deep (D109, D170). A flyout stays open for a moment after the pointer leaves,
 * so the pointer can cross to it.
 */
function MenuLevel({ items, run, sub, x, y }: { items: MenuItem[]; run: (item: MenuItem) => void; sub: boolean; x?: number; y?: number }) {
  const [open, setOpen] = useState<number | null>(null)
  const ref = useRef<HTMLDivElement>(null)
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const enter = (i: number | null) => {
    if (closeTimer.current) clearTimeout(closeTimer.current)
    closeTimer.current = null
    setOpen(i)
  }
  const leave = (i: number) => {
    if (closeTimer.current) clearTimeout(closeTimer.current)
    closeTimer.current = setTimeout(() => setOpen((o) => (o === i ? null : o)), 300)
  }
  useLayoutEffect(() => {
    if (ref.current) keepInside(ref.current, sub)
  }, [sub, items])
  return (
    <div className={`context-menu${sub ? ' submenu' : ''}`} ref={ref} style={sub ? undefined : { left: x, top: y }} role="menu">
      {items.map((item, i) => (
        <div key={`${item.label} ${item.keyword ?? ''}`} className="menu-item-wrap" onMouseEnter={() => enter(item.children ? i : null)} onMouseLeave={() => leave(i)}>
          <button role="menuitem" className={`${item.danger ? 'danger' : ''}${item.children ? ' has-children' : ''}`} onClick={() => run(item)} aria-haspopup={item.children ? 'menu' : undefined} aria-expanded={item.children ? open === i : undefined}>
            <Label item={item} />
            {item.children && <span className="caret">{'▸'}</span>}
          </button>
          {item.children && open === i && <MenuLevel items={item.children} run={run} sub />}
        </div>
      ))}
    </div>
  )
}

/**
 * The one context menu of the app. Any click elsewhere, a wheel, or Escape closes it. An item
 * with children opens them beside it on hover; clicking the item itself runs its own action
 * when it has one (D109). Menus never run off the window.
 */
export function ContextMenuLayer() {
  const menu = useStore((s) => s.contextMenu)
  const closeMenu = useStore((s) => s.closeMenu)

  useEffect(() => {
    if (!menu) return
    const onPointerDown = (e: PointerEvent) => {
      if (e.target instanceof Element && e.target.closest('.context-menu')) return
      closeMenu()
    }
    const close = () => closeMenu()
    window.addEventListener('pointerdown', onPointerDown, true)
    window.addEventListener('wheel', close, true)
    window.addEventListener('blur', close)
    return () => {
      window.removeEventListener('pointerdown', onPointerDown, true)
      window.removeEventListener('wheel', close, true)
      window.removeEventListener('blur', close)
    }
  }, [menu, closeMenu])

  if (!menu) return null
  const run = (item: MenuItem) => {
    if (!item.run) return
    closeMenu()
    item.run()
  }
  return <MenuLevel key={`${menu.x},${menu.y}`} items={menu.items} run={run} sub={false} x={menu.x} y={menu.y} />
}
