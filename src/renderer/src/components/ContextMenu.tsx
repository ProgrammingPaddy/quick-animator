import { useEffect } from 'react'
import { useStore, type MenuItem } from '../state/store'

/** Open the right-click menu at a pointer event. */
export function showMenu(e: { clientX: number; clientY: number; preventDefault(): void }, items: MenuItem[]): void {
  e.preventDefault()
  if (items.length === 0) return
  useStore.getState().openMenu({ x: e.clientX, y: e.clientY, items })
}

/** The one context menu of the app. Any click elsewhere, a wheel, or Escape closes it. */
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
  const left = Math.min(menu.x, window.innerWidth - 190)
  const top = Math.min(menu.y, window.innerHeight - menu.items.length * 28 - 10)
  return (
    <div className="context-menu" style={{ left, top }} role="menu">
      {menu.items.map((item) => (
        <button
          key={item.label}
          role="menuitem"
          className={item.danger ? 'danger' : ''}
          onClick={() => {
            closeMenu()
            item.run()
          }}
        >
          {item.label}
        </button>
      ))}
    </div>
  )
}
