import { useEffect } from 'react'
import { editorRedo, editorUndo } from './code/editor'
import { ClassesDialogLayer } from './components/ClassesDialog'
import { ContextMenuLayer } from './components/ContextMenu'
import { DialogLayer } from './components/Dialog'
import { HelpOverlay } from './components/HelpOverlay'
import { Layout } from './Layout'
import { initProject } from './project/controller'
import { copySelection, cutSelection, deleteActions, deleteObjects, duplicateObjects, nudgeActions, nudgeObjects, pasteClipboard, requestRename } from './project/operations'
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
        if (store.classesDialog) return store.closeClassesDialog()
        if (store.help) return store.setHelp(false)
      }
      if (e.code === 'F1') {
        e.preventDefault()
        store.setHelp(!store.help)
        return
      }
      if (store.dialog || store.classesDialog || isTypingTarget(e.target)) return
      const { togglePlaying, stepFrames, setTime, setPlaying, contentEnd, time, selection, selectedActions, select, tool, setTool } = store
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
      if (ctrl && e.code === 'KeyX') {
        if (cutSelection()) e.preventDefault()
        return
      }
      if (ctrl && e.code === 'KeyD') {
        e.preventDefault()
        if (selection.length > 0) duplicateObjects(selection)
        return
      }
      if (ctrl && e.code === 'KeyA') {
        e.preventDefault()
        select(store.model?.objects.map((o) => o.name) ?? [])
        return
      }
      // Arrows act on the selection: actions move by a frame, objects by a pixel (D95). With
      // nothing selected they step the playhead.
      const arrow = e.code === 'ArrowLeft' ? [-1, 0] : e.code === 'ArrowRight' ? [1, 0] : e.code === 'ArrowUp' ? [0, 1] : e.code === 'ArrowDown' ? [0, -1] : null
      if (arrow) {
        e.preventDefault()
        if (selectedActions.length > 0) {
          if (arrow[0] !== 0) nudgeActions(selectedActions, arrow[0]!)
        } else if (selection.length > 0) nudgeObjects(selection, arrow[0]!, arrow[1]!)
        else if (arrow[0] !== 0) stepFrames(arrow[0]! * (e.shiftKey ? 10 : 1))
        return
      }
      switch (e.code) {
        case 'Space':
          e.preventDefault()
          togglePlaying()
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
          if (selectedActions[0]) requestRename({ object: selectedActions[0].object, index: selectedActions[0].index })
          else if (selection.length === 1) requestRename({ object: selection[0]! })
          break
        case 'Delete':
        case 'Backspace':
          // Delete what is fully highlighted: the selected actions, or else the selected objects (D73).
          if (selectedActions.length > 0) {
            e.preventDefault()
            deleteActions(selectedActions)
          } else if (selection.length > 0) {
            e.preventDefault()
            deleteObjects(selection)
          }
          break
        case 'Escape':
          if (tool !== 'select') setTool('select')
          else if (selectedActions.length > 0) select(selection)
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
      <ClassesDialogLayer />
      <HelpOverlay />
    </>
  )
}
