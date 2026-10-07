import { useEffect } from 'react'
import { editorRedo, editorUndo } from './code/editor'
import { ContextMenuLayer } from './components/ContextMenu'
import { Layout } from './Layout'
import { initProject } from './project/controller'
import { deleteObjects } from './project/operations'
import { useClock } from './state/clock'
import { useStore } from './state/store'

/** True when the key event came from somewhere that handles its own typing. */
function isTypingTarget(target: EventTarget | null): boolean {
  const el = target instanceof HTMLElement ? target : null
  return !!el && !!el.closest('.cm-editor, input, textarea, select, [contenteditable]')
}

export function App() {
  useClock()

  useEffect(() => {
    initProject()
  }, [])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const store = useStore.getState()
      if (e.code === 'Escape' && store.contextMenu) {
        store.closeMenu()
        return
      }
      if (isTypingTarget(e.target)) return
      const { togglePlaying, stepFrames, setTime, setPlaying, contentEnd, time, selection, select, tool, setTool } = store
      const ctrl = e.ctrlKey || e.metaKey
      if (ctrl && (e.code === 'KeyZ' || e.code === 'KeyY')) {
        e.preventDefault()
        if (e.code === 'KeyY' || e.shiftKey) editorRedo()
        else editorUndo()
        return
      }
      switch (e.code) {
        case 'Space':
          e.preventDefault()
          togglePlaying()
          break
        case 'ArrowLeft':
          e.preventDefault()
          stepFrames(e.shiftKey ? -10 : -1)
          break
        case 'ArrowRight':
          e.preventDefault()
          stepFrames(e.shiftKey ? 10 : 1)
          break
        case 'Home':
          e.preventDefault()
          setPlaying(false)
          setTime(0)
          break
        case 'End':
          e.preventDefault()
          setPlaying(false)
          setTime(contentEnd ?? time)
          break
        case 'Delete':
        case 'Backspace':
          if (selection.length > 0) {
            e.preventDefault()
            deleteObjects(selection)
          }
          break
        case 'Escape':
          if (tool !== 'select') setTool('select')
          else select([])
          break
      }
    }
    // Ctrl and the wheel zoom a pane, never the whole app. Pinch gestures arrive the same way.
    const onWheel = (e: WheelEvent) => {
      if (e.ctrlKey || e.metaKey) e.preventDefault()
    }
    window.addEventListener('keydown', onKey)
    window.addEventListener('wheel', onWheel, { passive: false })
    return () => {
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('wheel', onWheel)
    }
  }, [])

  return (
    <>
      <Layout />
      <ContextMenuLayer />
    </>
  )
}
