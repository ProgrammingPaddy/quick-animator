import { useEffect } from 'react'
import { editorRedo, editorUndo } from './code/editor'
import { ContextMenuLayer } from './components/ContextMenu'
import { DialogLayer } from './components/Dialog'
import { HelpOverlay } from './components/HelpOverlay'
import { Layout } from './Layout'
import { initProject } from './project/controller'
import { copySelection, deleteAction, deleteObjects, duplicateObject, pasteClipboard, requestRename } from './project/operations'
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
      if (e.code === 'Escape') {
        if (store.contextMenu) return store.closeMenu()
        if (store.dialog) return store.closeDialog()
        if (store.help) return store.setHelp(false)
      }
      if (e.code === 'F1') {
        e.preventDefault()
        store.setHelp(!store.help)
        return
      }
      if (store.dialog || isTypingTarget(e.target)) return
      const { togglePlaying, stepFrames, setTime, setPlaying, contentEnd, time, selection, selectedAction, select, tool, setTool } = store
      const ctrl = e.ctrlKey || e.metaKey
      if (ctrl && (e.code === 'KeyZ' || e.code === 'KeyY')) {
        e.preventDefault()
        if (e.code === 'KeyY' || e.shiftKey) editorRedo()
        else editorUndo()
        return
      }
      if (ctrl && e.code === 'KeyC') {
        if (copySelection()) e.preventDefault()
        return
      }
      if (ctrl && e.code === 'KeyV') {
        if (pasteClipboard()) e.preventDefault()
        return
      }
      if (ctrl && e.code === 'KeyD') {
        e.preventDefault()
        if (selection[0]) duplicateObject(selection[0])
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
        case 'F2':
          e.preventDefault()
          if (selectedAction) requestRename({ object: selectedAction.object, index: selectedAction.index })
          else if (selection[0]) requestRename({ object: selection[0] })
          break
        case 'Delete':
        case 'Backspace':
          // Delete what is fully highlighted: the selected action, or else the selected objects (D73).
          if (selectedAction) {
            e.preventDefault()
            deleteAction(selectedAction.object, selectedAction.index)
          } else if (selection.length > 0) {
            e.preventDefault()
            deleteObjects(selection)
          }
          break
        case 'Escape':
          if (tool !== 'select') setTool('select')
          else if (selectedAction) select(selection)
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
      <DialogLayer />
      <HelpOverlay />
    </>
  )
}
