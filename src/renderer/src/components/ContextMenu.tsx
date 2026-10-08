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
 * The one context menu of the app. Any click elsewhere, a wheel, or Escape closes it. An item
 * with children opens them beside it on hover; clicking the item itself runs its own action
 * when it has one (D109). Menus never run off the window.
 */
export function ContextMenuLayer() {
  const menu = useStore((s) => s.contextMenu)
  const closeMenu = useStore((s) => s.closeMenu)
  const [open, setOpen] = useState<number | null>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const subRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    setOpen(null)
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

  useLayoutEffect(() => {
    if (menuRef.current) keepInside(menuRef.current)
  }, [menu])

  useLayoutEffect(() => {
    if (subRef.current) keepInside(subRef.current, true)
  }, [open])

  if (!menu) return null
  const run = (item: MenuItem) => {
    if (!item.run) return
    closeMenu()
    item.run()
  }
  return (
    <div className="context-menu" ref={menuRef} style={{ left: menu.x, top: menu.y }} role="menu">
      {menu.items.map((item, i) => (
        <div key={`${item.label} ${item.keyword ?? ''}`} className="menu-item-wrap" onMouseEnter={() => setOpen(item.children ? i : null)} onMouseLeave={() => setOpen((o) => (o === i ? null : o))}>
          <button role="menuitem" className={`${item.danger ? 'danger' : ''}${item.children ? ' has-children' : ''}`} onClick={() => run(item)} aria-haspopup={item.children ? 'menu' : undefined} aria-expanded={item.children ? open === i : undefined}>
            <Label item={item} />
            {item.children && <span className="caret">{'▸'}</span>}
          </button>
          {item.children && open === i && (
            <div className="context-menu submenu" ref={subRef} role="menu">
              {item.children.map((child) => (
                <button key={`${child.label} ${child.keyword ?? ''}`} role="menuitem" className={child.danger ? 'danger' : ''} onClick={() => run(child)}>
                  <Label item={child} />
                </button>
              ))}
            </div>
          )}
        </div>
      ))}
    </div>
  )
}
