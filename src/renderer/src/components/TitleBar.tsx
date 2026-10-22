import type { MouseEvent as ReactMouseEvent } from 'react'
import { editorRedo, editorUndo } from '../code/editor'
import { importSvgFile, newProject, pickProject } from '../project/controller'
import { keysLabel, NO_OVERRIDES } from '../state/hotkeys'
import { useStore } from '../state/store'
import icon from '../../../../resources/icon-mono.svg'

/**
 * The top of the window, in place of the system title bar and the menu (D108, D261): File,
 * which drops down Open, New, Import, and Export, then Preferences and Help on the left; the app
 * and project names in the middle; undo and redo as arrows on the right, before the room left
 * for the system's window controls. The bar drags the window; its buttons do not.
 */
export function TitleBar() {
  const project = useStore((s) => s.project)
  const setHelp = useStore((s) => s.setHelp)
  const setExportOpen = useStore((s) => s.setExportOpen)
  const setPrefsOpen = useStore((s) => s.setPrefsOpen)
  const overrides = useStore((s) => s.prefs.hotkeys) ?? NO_OVERRIDES
  const key = (id: string) => keysLabel(id, overrides, true)
  const openFile = (e: ReactMouseEvent<HTMLButtonElement>) => {
    const r = e.currentTarget.getBoundingClientRect()
    useStore.getState().openMenu({
      x: r.left,
      y: r.bottom + 2,
      items: [
        { label: 'Open', run: () => void pickProject() },
        { label: 'New', run: () => void newProject() },
        { label: 'Import', run: () => void importSvgFile() },
        { label: 'Export', keyword: key('export'), run: () => setExportOpen(true) },
      ],
    })
  }
  return (
    <div className="titlebar">
      <div className="titlebar-actions">
        {window.api && (
          <button className="menu-button" onClick={openFile} title="Open, New, Import, Export" aria-haspopup="menu">
            File <span className="caret">{'▾'}</span>
          </button>
        )}
        <button onClick={() => setPrefsOpen(true)} title={`Preferences (${key('preferences')})`}>
          Preferences
        </button>
        <button onClick={() => setHelp(true)} title={`Help (${key('help')})`}>
          Help
        </button>
      </div>
      <div className="titlebar-title" title={project?.path}>
        <img className="app-icon" src={icon} alt="" />
        <span className="app-name">Quick Animator</span>
        {project && <span className="separator">{'·'}</span>}
        {project && <span className="project-name">{project.name}</span>}
      </div>
      <div className="titlebar-right">
        <button className="icon" onClick={editorUndo} title={`Undo (${key('undo')})`} aria-label="Undo">
          <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
            <path d="M6.5 3.5 3 7l3.5 3.5" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
            <path d="M3.5 7H10a3 3 0 0 1 0 6H8" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
          </svg>
          <span className="sr-only">Undo</span>
        </button>
        <button className="icon" onClick={editorRedo} title={`Redo (${key('redo')})`} aria-label="Redo">
          <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
            <path d="M9.5 3.5 13 7l-3.5 3.5" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
            <path d="M12.5 7H6a3 3 0 0 0 0 6h2" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
          </svg>
          <span className="sr-only">Redo</span>
        </button>
        <div className="titlebar-spacer" />
      </div>
    </div>
  )
}
