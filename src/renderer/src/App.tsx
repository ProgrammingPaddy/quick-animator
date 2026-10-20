import { useEffect } from 'react'
import { editorRedo, editorUndo } from './code/editor'
import { ClassesDialogLayer } from './components/ClassesDialog'
import { ContextMenuLayer } from './components/ContextMenu'
import { DialogLayer } from './components/Dialog'
import { ExportDialogLayer } from './components/ExportDialog'
import { LinksDialogLayer } from './components/LinksDialog'
import { PreferencesDialogLayer } from './components/PreferencesDialog'
import { HelpOverlay } from './components/HelpOverlay'
import { Layout } from './Layout'
import { runHeadless } from './export/headless'
import { initProject } from './project/controller'
import { copySelection, cutSelection, deleteActions, deleteObjects, duplicateObjects, importSvg, nudgeActions, nudgeObjects, nudgeObjectsInTime, pasteClipboard, removePathPoints, removeShapePoints, settleMorph, requestRename } from './project/operations'
import { useClock } from './state/clock'
import { dropTargets } from './state/dropTargets'
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
    // Started with a render command, the window renders and the app exits (R111).
    void runHeadless()
  }, [])

  useEffect(() => {
    // The pane the pointer last went down in decides what the arrow keys move (D141).
    const onPointerDown = (e: PointerEvent) => {
      const pane = e.target instanceof Element ? e.target.closest('.preview, .timeline, .objects, .code-pane, .now-values') : null
      const name = !pane ? null : pane.classList.contains('preview') ? 'preview' : pane.classList.contains('timeline') ? 'timeline' : pane.classList.contains('objects') ? 'objects' : pane.classList.contains('code-pane') ? 'code' : 'now'
      useStore.getState().setActivePane(name)
    }
    window.addEventListener('pointerdown', onPointerDown, true)
    return () => window.removeEventListener('pointerdown', onPointerDown, true)
  }, [])

  // Files dragged in (D241): an .svg dropped on the preview is imported where it lands; no file is ever opened in place of the app.
  useEffect(() => {
    const carriesFiles = (dt: DataTransfer | null): dt is DataTransfer => !!dt && Array.from(dt.types).some((t) => t === 'Files' || t === 'text/uri-list')
    // Both dragenter and dragover must be taken, or the drop is refused; the copy cursor only where the source allows it.
    const over = (e: DragEvent) => {
      if (!carriesFiles(e.dataTransfer)) return
      e.preventDefault()
      if (/^(all|copy|copyMove|copyLink|uninitialized)$/.test(e.dataTransfer.effectAllowed)) e.dataTransfer.dropEffect = 'copy'
    }
    const drop = (e: DragEvent) => {
      if (!carriesFiles(e.dataTransfer)) return
      e.preventDefault()
      const notice = useStore.getState().setNotice
      const target = e.target instanceof Element ? e.target : null
      const where = dropTargets.preview?.(e.clientX, e.clientY)?.world ?? dropTargets.previewCenter?.() ?? { x: 0, y: 0 }
      const files = Array.from(e.dataTransfer.files)
      // Some sources, a code editor say, hand over paths rather than files; the main process reads those.
      const paths = files.length > 0 ? [] : (e.dataTransfer.getData('text/uri-list') || '').split(/\r?\n/).filter((l) => l.startsWith('file:')).map((l) => decodeURIComponent(new URL(l).pathname).replace(/^\/([A-Za-z]:)/, '$1'))
      const svgs = files.filter((f) => /\.svg$/i.test(f.name))
      const svgPaths = paths.filter((p) => /\.svg$/i.test(p))
      if (svgs.length === 0 && svgPaths.length === 0) {
        notice(files.length + paths.length > 0 ? 'Only .svg files can be imported.' : 'Nothing to import was dropped.')
        return
      }
      if (!target?.closest('.preview')) {
        notice('Drop an .svg on the preview to import it.')
        return
      }
      for (const file of svgs) void file.text().then((text) => importSvg(text, file.name.replace(/\.svg$/i, ''), where))
      for (const path of svgPaths) void window.api?.project.readFile(path).then((text) => importSvg(text, path.replace(/^.*[\\/]/, '').replace(/\.svg$/i, ''), where))
    }
    window.addEventListener('dragenter', over)
    window.addEventListener('dragover', over)
    window.addEventListener('drop', drop)
    return () => {
      window.removeEventListener('dragenter', over)
      window.removeEventListener('dragover', over)
      window.removeEventListener('drop', drop)
    }
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
      // The export dialog handles its own keys.
      if (store.exportOpen) return
      if (e.code === 'F1') {
        e.preventDefault()
        store.setHelp(!store.help)
        return
      }
      if (store.dialog || store.classesDialog || store.linksDialog || isTypingTarget(e.target)) return
      const { togglePlaying, stepFrames, setTime, setPlaying, contentEnd, time, selection, selectedActions, select, tool, setTool } = store
      const ctrl = e.ctrlKey || e.metaKey
      if (ctrl && e.code === 'KeyE') {
        e.preventDefault()
        if (window.api) store.setExportOpen(true)
        return
      }
      if (ctrl && e.code === 'Comma') {
        e.preventDefault()
        store.setPrefsOpen(true)
        return
      }
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
        } else if (selection.length > 0) {
          // In the preview the arrows move the objects in space; anywhere else, left and right move them in time (D141).
          if (store.activePane === 'preview') nudgeObjects(selection, arrow[0]!, arrow[1]!)
          else if (arrow[0] !== 0) nudgeObjectsInTime(selection, arrow[0]! * (e.shiftKey ? 10 : 1))
        } else if (arrow[0] !== 0) stepFrames(arrow[0]! * (e.shiftKey ? 10 : 1))
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
          // Delete what is fully highlighted: a path's picked points (D194, D198), the selected actions, or else the selected objects (D73).
          if (store.pathPoints.length > 0 && selectedActions.length === 1) {
            e.preventDefault()
            removePathPoints(selectedActions[0]!, store.pathPoints)
            store.setPathPoints([])
          } else if (store.pathPoints.length > 0 && selection.length === 1 && store.model?.objects.some((o) => o.name === selection[0] && o.className === 'Shape')) {
            // A selected Shape's picked points (D233); while a morph runs, its end first (D257).
            e.preventDefault()
            if (!settleMorph(selection[0]!)) removeShapePoints(selection[0]!, store.pathPoints)
            store.setPathPoints([])
          } else if (selectedActions.length > 0) {
            e.preventDefault()
            deleteActions(selectedActions)
          } else if (selection.length > 0) {
            e.preventDefault()
            deleteObjects(selection)
          }
          break
        case 'Escape':
          if (tool !== 'select') setTool('select')
          else if (store.pathPoints.length > 0) store.setPathPoints([])
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
      <ExportDialogLayer />
      <PreferencesDialogLayer />
      <LinksDialogLayer />
      <ClassesDialogLayer />
      <HelpOverlay />
    </>
  )
}
